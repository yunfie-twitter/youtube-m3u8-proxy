import Fastify from 'fastify';
import { Innertube } from 'youtubei.js/web';
import { createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
  trustProxy: true
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize Innertube instance
let innertube;
(async () => {
  innertube = await Innertube.create({
    cache: false,
    generate_session_locally: true
  });
})();

// CORS configuration
fastify.addHook('onRequest', async (request, reply) => {
  reply.headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  
  if (request.method === 'OPTIONS') {
    reply.code(200).send();
  }
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Serve demo page
fastify.get('/', async (request, reply) => {
  reply.type('text/html');
  return createReadStream(join(__dirname, 'demo.html'));
});

// Get video info
fastify.get('/api/info/:videoId', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const info = await innertube.getInfo(videoId);
    
    const videoDetails = {
      id: info.basic_info.id,
      title: info.basic_info.title,
      author: info.basic_info.author,
      duration: info.basic_info.duration,
      thumbnail: info.basic_info.thumbnail?.[0]?.url,
      viewCount: info.basic_info.view_count,
      isLive: info.basic_info.is_live
    };
    
    return videoDetails;
  } catch (error) {
    reply.code(500).send({ error: error.message });
  }
});

// Generate M3U8 manifest for video
fastify.get('/api/manifest/:videoId.m3u8', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const { quality = 'auto' } = request.query;
    
    const info = await innertube.getInfo(videoId, { client: 'TVHTML5' });
    
    // Get HLS manifest URL if available (for live streams)
    if (info.streaming_data?.hls_manifest_url) {
      const hlsUrl = info.streaming_data.hls_manifest_url;
      const response = await fetch(hlsUrl);
      const manifest = await response.text();
      
      // Rewrite URLs in manifest to proxy through our server
      const rewrittenManifest = manifest.replace(
        /(https:\/\/[^\s]+)/g,
        (match) => {
          const encodedUrl = encodeURIComponent(match);
          return `${request.protocol}://${request.hostname}/api/proxy?url=${encodedUrl}`;
        }
      );
      
      reply.type('application/vnd.apple.mpegurl').send(rewrittenManifest);
      return;
    }
    
    // For non-live videos, create custom M3U8 from adaptive formats
    const formats = info.streaming_data.adaptive_formats
      .filter(f => f.has_video && f.has_audio === false)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    
    if (formats.length === 0) {
      throw new Error('No suitable formats found');
    }
    
    // Generate master playlist
    let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n';
    
    for (const format of formats) {
      const bandwidth = format.bitrate || 0;
      const resolution = `${format.width}x${format.height}`;
      const proxyUrl = `${request.protocol}://${request.hostname}/api/stream/${videoId}/${format.itag}.m3u8`;
      
      manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
      manifest += `${proxyUrl}\n`;
    }
    
    reply.type('application/vnd.apple.mpegurl').send(manifest);
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Generate individual stream M3U8
fastify.get('/api/stream/:videoId/:itag.m3u8', async (request, reply) => {
  try {
    const { videoId, itag } = request.params;
    const info = await innertube.getInfo(videoId, { client: 'TVHTML5' });
    
    const format = info.streaming_data.adaptive_formats.find(
      f => f.itag === parseInt(itag)
    );
    
    if (!format) {
      return reply.code(404).send({ error: 'Format not found' });
    }
    
    const duration = info.basic_info.duration || 0;
    const segmentDuration = 10; // 10 seconds per segment
    const numSegments = Math.ceil(duration / segmentDuration);
    
    // Generate media playlist
    let manifest = '#EXTM3U\n';
    manifest += '#EXT-X-VERSION:3\n';
    manifest += '#EXT-X-TARGETDURATION:' + segmentDuration + '\n';
    manifest += '#EXT-X-MEDIA-SEQUENCE:0\n';
    manifest += '#EXT-X-PLAYLIST-TYPE:VOD\n';
    
    for (let i = 0; i < numSegments; i++) {
      const start = i * segmentDuration;
      const end = Math.min((i + 1) * segmentDuration, duration);
      const actualDuration = end - start;
      
      manifest += `#EXTINF:${actualDuration.toFixed(3)},\n`;
      manifest += `${request.protocol}://${request.hostname}/api/segment/${videoId}/${itag}/${start}/${end}\n`;
    }
    
    manifest += '#EXT-X-ENDLIST\n';
    
    reply.type('application/vnd.apple.mpegurl').send(manifest);
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Proxy video segments with range support
fastify.get('/api/segment/:videoId/:itag/:start/:end', async (request, reply) => {
  try {
    const { videoId, itag, start, end } = request.params;
    const info = await innertube.getInfo(videoId, { client: 'TVHTML5' });
    
    const format = info.streaming_data.adaptive_formats.find(
      f => f.itag === parseInt(itag)
    );
    
    if (!format || !format.url) {
      return reply.code(404).send({ error: 'Format not found' });
    }
    
    // Calculate byte range based on time range
    const contentLength = format.content_length ? parseInt(format.content_length) : 0;
    const duration = info.basic_info.duration || 0;
    
    if (contentLength && duration) {
      const byteRate = contentLength / duration;
      const rangeStart = Math.floor(parseFloat(start) * byteRate);
      const rangeEnd = Math.floor(parseFloat(end) * byteRate);
      
      const response = await fetch(format.url, {
        headers: {
          'Range': `bytes=${rangeStart}-${rangeEnd}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      reply.type(format.mime_type || 'video/mp4');
      reply.headers({
        'Accept-Ranges': 'bytes',
        'Content-Length': response.headers.get('content-length')
      });
      
      return reply.send(await response.arrayBuffer());
    }
    
    // Fallback: proxy entire video
    const response = await fetch(format.url);
    reply.type(format.mime_type || 'video/mp4');
    return reply.send(await response.arrayBuffer());
    
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Generic proxy endpoint
fastify.get('/api/proxy', async (request, reply) => {
  try {
    const { url } = request.query;
    
    if (!url) {
      return reply.code(400).send({ error: 'URL parameter required' });
    }
    
    const decodedUrl = decodeURIComponent(url);
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const contentType = response.headers.get('content-type');
    if (contentType) {
      reply.type(contentType);
    }
    
    return reply.send(await response.arrayBuffer());
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 YouTube M3U8 Proxy Server running on http://${HOST}:${PORT}`);
    console.log(`📺 Demo page: http://localhost:${PORT}`);
    console.log(`🔧 API endpoint: http://localhost:${PORT}/api/manifest/{videoId}.m3u8\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
