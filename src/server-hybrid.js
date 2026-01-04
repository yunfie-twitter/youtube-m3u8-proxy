import Fastify from 'fastify';
import { Innertube } from 'youtubei.js/web';
import { createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Redis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: true,
  trustProxy: true
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const YTDLP_API_URL = process.env.YTDLP_API_URL || 'http://localhost:8080';
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600'); // 1 hour
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE || '1000');

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 50, 2000);
  }
});

redis.on('error', (err) => {
  fastify.log.error('Redis connection error:', err);
});

redis.on('connect', () => {
  fastify.log.info('Redis connected successfully');
});

// Initialize Innertube
let innertube;
(async () => {
  try {
    innertube = await Innertube.create({
      cache: false,
      generate_session_locally: true
    });
    fastify.log.info('Innertube initialized successfully');
  } catch (error) {
    fastify.log.error('Failed to initialize Innertube:', error);
  }
})();

// Cache helper functions
async function getCached(key) {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    fastify.log.error('Cache get error:', error);
  }
  return null;
}

async function setCache(key, value, ttl = CACHE_TTL) {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    fastify.log.error('Cache set error:', error);
  }
}

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
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      innertube: !!innertube,
      redis: redis.status === 'ready'
    }
  };
  
  // Check yt-dlp service
  try {
    const response = await fetch(`${YTDLP_API_URL}/health`);
    health.services.ytdlp = response.ok;
  } catch (error) {
    health.services.ytdlp = false;
  }
  
  return health;
});

// Serve demo page
fastify.get('/', async (request, reply) => {
  reply.type('text/html');
  return createReadStream(join(__dirname, 'demo.html'));
});

// Hybrid strategy: Try youtube.js first, fallback to yt-dlp
async function getVideoManifest(videoId) {
  const cacheKey = `manifest:${videoId}`;
  
  // Check cache first
  const cached = await getCached(cacheKey);
  if (cached) {
    fastify.log.info(`Cache hit for ${videoId}`);
    return { ...cached, source: 'cache' };
  }
  
  // Step 1: Try youtube.js (fast)
  fastify.log.info(`[1/3] Trying youtube.js for ${videoId}`);
  try {
    const info = await innertube.getInfo(videoId, { client: 'TVHTML5' });
    
    // Check for HLS manifest
    if (info.streaming_data?.hls_manifest_url) {
      const result = {
        videoId,
        manifestUrl: info.streaming_data.hls_manifest_url,
        type: 'hls',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        source: 'youtube.js'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] youtube.js found HLS for ${videoId}`);
      return result;
    }
    
    // Check for DASH manifest
    if (info.streaming_data?.dash_manifest_url) {
      const result = {
        videoId,
        manifestUrl: info.streaming_data.dash_manifest_url,
        type: 'dash',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        formats: info.streaming_data.adaptive_formats,
        source: 'youtube.js'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] youtube.js found DASH for ${videoId}`);
      return result;
    }
    
    // Check adaptive formats
    if (info.streaming_data?.adaptive_formats?.length > 0) {
      const result = {
        videoId,
        type: 'adaptive',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        formats: info.streaming_data.adaptive_formats,
        source: 'youtube.js'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] youtube.js found adaptive formats for ${videoId}`);
      return result;
    }
    
    fastify.log.warn(`[!] youtube.js: No manifest found for ${videoId}`);
  } catch (error) {
    fastify.log.error(`[✗] youtube.js failed for ${videoId}:`, error.message);
  }
  
  // Step 2: Fallback to yt-dlp (reliable)
  fastify.log.info(`[2/3] Falling back to yt-dlp for ${videoId}`);
  try {
    const response = await fetch(`${YTDLP_API_URL}/api/extract/${videoId}`);
    
    if (!response.ok) {
      throw new Error(`yt-dlp API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check for HLS manifest
    if (data.hls_manifest_url) {
      const result = {
        videoId,
        manifestUrl: data.hls_manifest_url,
        type: 'hls',
        title: data.title,
        duration: data.duration,
        source: 'yt-dlp'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] yt-dlp found HLS for ${videoId}`);
      return result;
    }
    
    // Check for DASH manifest
    if (data.dash_manifest_url) {
      const result = {
        videoId,
        manifestUrl: data.dash_manifest_url,
        type: 'dash',
        title: data.title,
        duration: data.duration,
        source: 'yt-dlp'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] yt-dlp found DASH for ${videoId}`);
      return result;
    }
    
    // Use formats from yt-dlp
    if (data.formats?.length > 0) {
      const result = {
        videoId,
        type: 'formats',
        title: data.title,
        duration: data.duration,
        formats: data.formats,
        source: 'yt-dlp'
      };
      
      await setCache(cacheKey, result);
      fastify.log.info(`[✓] yt-dlp found formats for ${videoId}`);
      return result;
    }
    
    fastify.log.warn(`[!] yt-dlp: No usable data for ${videoId}`);
  } catch (error) {
    fastify.log.error(`[✗] yt-dlp failed for ${videoId}:`, error.message);
  }
  
  // Step 3: All methods failed
  fastify.log.error(`[✗✗✗] All methods failed for ${videoId}`);
  return null;
}

// Get video info with hybrid strategy
fastify.get('/api/info/:videoId', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const result = await getVideoManifest(videoId);
    
    if (!result) {
      return reply.code(404).send({ error: 'Video not found or no manifest available' });
    }
    
    return {
      id: result.videoId,
      title: result.title,
      duration: result.duration,
      manifestType: result.type,
      manifestUrl: result.manifestUrl,
      source: result.source,
      cached: result.source === 'cache'
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Generate M3U8 manifest with hybrid strategy
fastify.get('/api/manifest/:videoId.m3u8', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const result = await getVideoManifest(videoId);
    
    if (!result) {
      return reply.code(404).send({ error: 'Video not found or no manifest available' });
    }
    
    // If we have a direct HLS manifest URL
    if (result.type === 'hls' && result.manifestUrl) {
      const response = await fetch(result.manifestUrl);
      const manifest = await response.text();
      
      // Rewrite URLs to proxy through our server
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
    
    // Generate custom M3U8 from formats
    if (result.formats && result.formats.length > 0) {
      let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n';
      
      // Filter and sort formats
      const videoFormats = result.formats
        .filter(f => {
          if (result.source === 'yt-dlp') {
            return f.vcodec && f.vcodec !== 'none';
          }
          return f.has_video && !f.has_audio;
        })
        .sort((a, b) => {
          const bitrateA = a.tbr || a.bitrate || 0;
          const bitrateB = b.tbr || b.bitrate || 0;
          return bitrateB - bitrateA;
        })
        .slice(0, 5); // Limit to top 5 qualities
      
      for (const format of videoFormats) {
        const bandwidth = (format.tbr || format.bitrate || 0) * 1000;
        const resolution = `${format.width || 0}x${format.height || 0}`;
        const formatId = format.format_id || format.itag;
        const proxyUrl = `${request.protocol}://${request.hostname}/api/stream/${videoId}/${formatId}.m3u8`;
        
        manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
        manifest += `${proxyUrl}\n`;
      }
      
      reply.type('application/vnd.apple.mpegurl').send(manifest);
      return;
    }
    
    reply.code(404).send({ error: 'No suitable manifest or formats found' });
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Proxy endpoint
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

// Clear cache endpoint
fastify.delete('/api/cache/:videoId', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const cacheKey = `manifest:${videoId}`;
    await redis.del(cacheKey);
    return { success: true, message: `Cache cleared for ${videoId}` };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Stats endpoint
fastify.get('/api/stats', async (request, reply) => {
  try {
    const cacheKeys = await redis.keys('manifest:*');
    const cacheSize = cacheKeys.length;
    
    return {
      cacheSize,
      maxCacheSize: CACHE_MAX_SIZE,
      cacheTTL: CACHE_TTL,
      redisStatus: redis.status
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, closing gracefully');
  await redis.quit();
  await fastify.close();
  process.exit(0);
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 YouTube M3U8 Proxy (Hybrid) running on http://${HOST}:${PORT}`);
    console.log(`📺 Demo page: http://localhost:${PORT}`);
    console.log(`🔧 API endpoint: http://localhost:${PORT}/api/manifest/{videoId}.m3u8`);
    console.log(`⚡ Hybrid strategy: youtube.js → yt-dlp → cache`);
    console.log(`💾 Cache TTL: ${CACHE_TTL}s, Max size: ${CACHE_MAX_SIZE}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
