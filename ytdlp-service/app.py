#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(
    title="yt-dlp API Service",
    description="Persistent yt-dlp service for extracting YouTube m3u8 URLs",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Response models
class VideoInfo(BaseModel):
    video_id: str
    title: str
    duration: Optional[int] = None
    formats: list
    manifest_url: Optional[str] = None
    hls_manifest_url: Optional[str] = None
    dash_manifest_url: Optional[str] = None
    thumbnail: Optional[str] = None
    uploader: Optional[str] = None
    view_count: Optional[int] = None

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str

# yt-dlp options
def get_ytdlp_opts() -> Dict[str, Any]:
    return {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
        'skip_download': True,
        'format': 'best',
        'no_check_certificate': True,
        'cookiefile': None,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

async def extract_info_async(video_id: str) -> Dict[str, Any]:
    """Extract video info using yt-dlp in a thread pool"""
    loop = asyncio.get_event_loop()
    
    def _extract():
        url = f'https://www.youtube.com/watch?v={video_id}'
        opts = get_ytdlp_opts()
        
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return info
        except Exception as e:
            logger.error(f"yt-dlp extraction failed for {video_id}: {str(e)}")
            raise
    
    return await loop.run_in_executor(None, _extract)

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="ok",
        timestamp=datetime.utcnow().isoformat(),
        version=yt_dlp.version.__version__
    )

@app.get("/api/extract/{video_id}", response_model=VideoInfo)
async def extract_video_info(video_id: str):
    """Extract video information including m3u8 URLs"""
    try:
        logger.info(f"Extracting info for video: {video_id}")
        
        # Extract info using yt-dlp
        info = await extract_info_async(video_id)
        
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")
        
        # Find HLS/DASH manifest URLs
        hls_manifest = None
        dash_manifest = None
        formats_list = []
        
        # Check for manifest URLs in formats
        if 'formats' in info:
            for fmt in info['formats']:
                format_info = {
                    'format_id': fmt.get('format_id'),
                    'ext': fmt.get('ext'),
                    'quality': fmt.get('quality'),
                    'width': fmt.get('width'),
                    'height': fmt.get('height'),
                    'fps': fmt.get('fps'),
                    'vcodec': fmt.get('vcodec'),
                    'acodec': fmt.get('acodec'),
                    'filesize': fmt.get('filesize'),
                    'tbr': fmt.get('tbr'),
                    'protocol': fmt.get('protocol'),
                    'url': fmt.get('url'),
                }
                
                # Check for HLS manifest
                if fmt.get('protocol') == 'm3u8_native' or fmt.get('ext') == 'm3u8':
                    if not hls_manifest:
                        hls_manifest = fmt.get('url')
                    format_info['is_hls'] = True
                
                # Check for DASH manifest
                if 'manifest_url' in fmt and 'dash' in fmt.get('protocol', '').lower():
                    if not dash_manifest:
                        dash_manifest = fmt.get('manifest_url')
                    format_info['is_dash'] = True
                
                formats_list.append(format_info)
        
        # Check top-level manifest URLs
        if not hls_manifest and 'manifest_url' in info:
            manifest_url = info['manifest_url']
            if 'm3u8' in manifest_url:
                hls_manifest = manifest_url
        
        if not hls_manifest and 'url' in info:
            url = info['url']
            if 'm3u8' in url:
                hls_manifest = url
        
        # Build response
        response = VideoInfo(
            video_id=video_id,
            title=info.get('title', 'Unknown'),
            duration=info.get('duration'),
            formats=formats_list,
            manifest_url=info.get('manifest_url'),
            hls_manifest_url=hls_manifest,
            dash_manifest_url=dash_manifest,
            thumbnail=info.get('thumbnail'),
            uploader=info.get('uploader'),
            view_count=info.get('view_count')
        )
        
        logger.info(f"Successfully extracted info for {video_id}. HLS: {bool(hls_manifest)}, DASH: {bool(dash_manifest)}")
        return response
        
    except yt_dlp.utils.DownloadError as e:
        logger.error(f"Download error for {video_id}: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error for {video_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/formats/{video_id}")
async def get_formats(video_id: str):
    """Get available formats for a video"""
    try:
        info = await extract_info_async(video_id)
        
        formats = []
        for fmt in info.get('formats', []):
            formats.append({
                'format_id': fmt.get('format_id'),
                'ext': fmt.get('ext'),
                'resolution': fmt.get('resolution'),
                'fps': fmt.get('fps'),
                'vcodec': fmt.get('vcodec'),
                'acodec': fmt.get('acodec'),
                'filesize': fmt.get('filesize'),
                'tbr': fmt.get('tbr'),
                'protocol': fmt.get('protocol'),
            })
        
        return JSONResponse(content={
            'video_id': video_id,
            'formats': formats
        })
        
    except Exception as e:
        logger.error(f"Error getting formats for {video_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 8080))
    workers = int(os.environ.get('WORKERS', 4))
    
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        log_level="info",
        access_log=True
    )
