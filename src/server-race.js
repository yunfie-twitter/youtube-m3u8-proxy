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
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600');
const RACE_TIMEOUT = parseInt(process.env.RACE_TIMEOUT || '10000'); // 10 seconds

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

redis.on('error', (err) => fastify.log.error('Redis error:', err));
redis.on('connect', () => fastify.log.info('Redis connected'));

// Initialize multiple Innertube clients
let innertubeClients = {};

(async () => {
  try {
    // Web client (fastest, most reliable)
    innertubeClients.web = await Innertube.create({
      cache: false,
      generate_session_locally: true
    });
    fastify.log.info('✓ Innertube Web client initialized');

    // Android client (alternative formats)
    innertubeClients.android = await Innertube.create({
      cache: false,
      generate_session_locally: true,
      client_type: 'ANDROID'
    });
    fastify.log.info('✓ Innertube Android client initialized');

    // TV client (high quality streams)
    innertubeClients.tv = await Innertube.create({
      cache: false,
      generate_session_locally: true,
      client_type: 'TVHTML5'
    });
    fastify.log.info('✓ Innertube TV client initialized');

  } catch (error) {
    fastify.log.error('Failed to initialize Innertube clients:', error);
  }
})();

// Cache helpers
async function getCached(key) {
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    fastify.log.error('Cache get error:', error);
    return null;
  }
}

async function setCache(key, value, ttl = CACHE_TTL) {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch (error) {
    fastify.log.error('Cache set error:', error);
  }
}

// CORS
fastify.addHook('onRequest', async (request, reply) => {
  reply.headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  if (request.method === 'OPTIONS') {
    reply.code(200).send();
  }
});

// Health check
fastify.get('/health', async (request, reply) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      innertubeWeb: !!innertubeClients.web,
      innertubeAndroid: !!innertubeClients.android,
      innertubeTv: !!innertubeClients.tv,
      redis: redis.status === 'ready',
      ytdlp: false
    }
  };
  
  try {
    const response = await fetch(`${YTDLP_API_URL}/health`, { signal: AbortSignal.timeout(2000) });
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

// Extract using youtube.js web client
async function extractWithYoutubeJsWeb(videoId) {
  const startTime = Date.now();
  try {
    if (!innertubeClients.web) throw new Error('Web client not initialized');
    
    const info = await innertubeClients.web.getInfo(videoId);
    const duration = Date.now() - startTime;
    
    if (info.streaming_data?.hls_manifest_url) {
      return {
        success: true,
        source: 'youtube.js-web',
        videoId,
        manifestUrl: info.streaming_data.hls_manifest_url,
        type: 'hls',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        extractTime: duration
      };
    }
    
    if (info.streaming_data?.adaptive_formats?.length > 0) {
      return {
        success: true,
        source: 'youtube.js-web',
        videoId,
        type: 'adaptive',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        formats: info.streaming_data.adaptive_formats,
        extractTime: duration
      };
    }
    
    throw new Error('No usable formats found');
  } catch (error) {
    return {
      success: false,
      source: 'youtube.js-web',
      error: error.message,
      extractTime: Date.now() - startTime
    };
  }
}

// Extract using youtube.js android client
async function extractWithYoutubeJsAndroid(videoId) {
  const startTime = Date.now();
  try {
    if (!innertubeClients.android) throw new Error('Android client not initialized');
    
    const info = await innertubeClients.android.getInfo(videoId);
    const duration = Date.now() - startTime;
    
    if (info.streaming_data?.hls_manifest_url) {
      return {
        success: true,
        source: 'youtube.js-android',
        videoId,
        manifestUrl: info.streaming_data.hls_manifest_url,
        type: 'hls',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        extractTime: duration
      };
    }
    
    if (info.streaming_data?.adaptive_formats?.length > 0) {
      return {
        success: true,
        source: 'youtube.js-android',
        videoId,
        type: 'adaptive',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        formats: info.streaming_data.adaptive_formats,
        extractTime: duration
      };
    }
    
    throw new Error('No usable formats found');
  } catch (error) {
    return {
      success: false,
      source: 'youtube.js-android',
      error: error.message,
      extractTime: Date.now() - startTime
    };
  }
}

// Extract using youtube.js TV client
async function extractWithYoutubeJsTv(videoId) {
  const startTime = Date.now();
  try {
    if (!innertubeClients.tv) throw new Error('TV client not initialized');
    
    const info = await innertubeClients.tv.getInfo(videoId, { client: 'TVHTML5' });
    const duration = Date.now() - startTime;
    
    if (info.streaming_data?.hls_manifest_url) {
      return {
        success: true,
        source: 'youtube.js-tv',
        videoId,
        manifestUrl: info.streaming_data.hls_manifest_url,
        type: 'hls',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        extractTime: duration
      };
    }
    
    if (info.streaming_data?.adaptive_formats?.length > 0) {
      return {
        success: true,
        source: 'youtube.js-tv',
        videoId,
        type: 'adaptive',
        title: info.basic_info.title,
        duration: info.basic_info.duration,
        formats: info.streaming_data.adaptive_formats,
        extractTime: duration
      };
    }
    
    throw new Error('No usable formats found');
  } catch (error) {
    return {
      success: false,
      source: 'youtube.js-tv',
      error: error.message,
      extractTime: Date.now() - startTime
    };
  }
}

// Extract using yt-dlp
async function extractWithYtDlp(videoId) {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RACE_TIMEOUT);
    
    const response = await fetch(`${YTDLP_API_URL}/api/extract/${videoId}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`yt-dlp API returned ${response.status}`);
    }
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    if (data.hls_manifest_url) {
      return {
        success: true,
        source: 'yt-dlp',
        videoId,
        manifestUrl: data.hls_manifest_url,
        type: 'hls',
        title: data.title,
        duration: data.duration,
        extractTime: duration
      };
    }
    
    if (data.formats?.length > 0) {
      return {
        success: true,
        source: 'yt-dlp',
        videoId,
        type: 'formats',
        title: data.title,
        duration: data.duration,
        formats: data.formats,
        extractTime: duration
      };
    }
    
    throw new Error('No usable data from yt-dlp');
  } catch (error) {
    return {
      success: false,
      source: 'yt-dlp',
      error: error.message,
      extractTime: Date.now() - startTime
    };
  }
}

// Race-based extraction with multiple sources
async function raceExtraction(videoId) {
  const cacheKey = `manifest:${videoId}`;
  
  // Check cache first
  const cached = await getCached(cacheKey);
  if (cached) {
    fastify.log.info(`[CACHE HIT] ${videoId}`);
    return { ...cached, fromCache: true };
  }
  
  fastify.log.info(`[RACE START] ${videoId} - Starting extraction race`);
  const raceStart = Date.now();
  
  // Create array of extraction promises
  const extractors = [
    extractWithYoutubeJsWeb(videoId),
    extractWithYoutubeJsAndroid(videoId),
    extractWithYoutubeJsTv(videoId),
    extractWithYtDlp(videoId)
  ];
  
  // Race: first successful result wins
  return new Promise((resolve, reject) => {
    let resolvedCount = 0;
    const results = [];
    let hasResolved = false;
    
    extractors.forEach((promise, index) => {
      promise.then(result => {
        results.push(result);
        resolvedCount++;
        
        // If this is a success and we haven't resolved yet, use it
        if (result.success && !hasResolved) {
          hasResolved = true;
          const totalTime = Date.now() - raceStart;
          
          fastify.log.info(
            `[RACE WIN] ${videoId} - Winner: ${result.source} ` +
            `(${result.extractTime}ms extract, ${totalTime}ms total)`
          );
          
          // Cache the winning result
          setCache(cacheKey, result);
          
          resolve({ ...result, totalRaceTime: totalTime, fromCache: false });
        }
        
        // If all promises resolved and none succeeded
        if (resolvedCount === extractors.length && !hasResolved) {
          const totalTime = Date.now() - raceStart;
          fastify.log.error(
            `[RACE FAIL] ${videoId} - All extractors failed (${totalTime}ms)`
          );
          
          // Log all failures
          results.forEach(r => {
            if (!r.success) {
              fastify.log.error(`  - ${r.source}: ${r.error}`);
            }
          });
          
          reject(new Error('All extraction methods failed'));
        }
      }).catch(error => {
        results.push({ success: false, source: 'unknown', error: error.message });
        resolvedCount++;
        
        if (resolvedCount === extractors.length && !hasResolved) {
          reject(new Error('All extraction methods failed'));
        }
      });
    });
    
    // Overall timeout
    setTimeout(() => {
      if (!hasResolved) {
        fastify.log.error(`[RACE TIMEOUT] ${videoId} - Exceeded ${RACE_TIMEOUT}ms`);
        reject(new Error('Race extraction timeout'));
      }
    }, RACE_TIMEOUT);
  });
}

// Get video info with race strategy
fastify.get('/api/info/:videoId', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const result = await raceExtraction(videoId);
    
    return {
      id: result.videoId,
      title: result.title,
      duration: result.duration,
      manifestType: result.type,
      manifestUrl: result.manifestUrl,
      source: result.source,
      extractTime: result.extractTime,
      totalRaceTime: result.totalRaceTime,
      fromCache: result.fromCache
    };
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Generate M3U8 manifest with race strategy
fastify.get('/api/manifest/:videoId.m3u8', async (request, reply) => {
  try {
    const { videoId } = request.params;
    const result = await raceExtraction(videoId);
    
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
      
      reply.header('X-Extraction-Source', result.source);
      reply.header('X-Extraction-Time', result.extractTime);
      reply.header('X-From-Cache', result.fromCache);
      reply.type('application/vnd.apple.mpegurl').send(rewrittenManifest);
      return;
    }
    
    // Generate custom M3U8 from formats
    if (result.formats && result.formats.length > 0) {
      let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n';
      
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
        .slice(0, 5);
      
      for (const format of videoFormats) {
        const bandwidth = (format.tbr || format.bitrate || 0) * 1000;
        const resolution = `${format.width || 0}x${format.height || 0}`;
        const formatId = format.format_id || format.itag;
        const proxyUrl = `${request.protocol}://${request.hostname}/api/stream/${videoId}/${formatId}.m3u8`;
        
        manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
        manifest += `${proxyUrl}\n`;
      }
      
      reply.header('X-Extraction-Source', result.source);
      reply.header('X-Extraction-Time', result.extractTime);
      reply.header('X-From-Cache', result.fromCache);
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
    if (!url) return reply.code(400).send({ error: 'URL parameter required' });
    
    const decodedUrl = decodeURIComponent(url);
    const response = await fetch(decodedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    const contentType = response.headers.get('content-type');
    if (contentType) reply.type(contentType);
    
    return reply.send(await response.arrayBuffer());
  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({ error: error.message });
  }
});

// Clear cache
fastify.delete('/api/cache/:videoId', async (request, reply) => {
  try {
    const { videoId } = request.params;
    await redis.del(`manifest:${videoId}`);
    return { success: true, message: `Cache cleared for ${videoId}` };
  } catch (error) {
    reply.code(500).send({ error: error.message });
  }
});

// Stats
fastify.get('/api/stats', async (request, reply) => {
  try {
    const cacheKeys = await redis.keys('manifest:*');
    return {
      cacheSize: cacheKeys.length,
      cacheTTL: CACHE_TTL,
      raceTimeout: RACE_TIMEOUT,
      redisStatus: redis.status,
      extractors: [
        'youtube.js-web',
        'youtube.js-android',
        'youtube.js-tv',
        'yt-dlp'
      ]
    };
  } catch (error) {
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
    console.log(`\n🚀 YouTube M3U8 Proxy (Race Mode) running on http://${HOST}:${PORT}`);
    console.log(`📺 Demo page: http://localhost:${PORT}`);
    console.log(`🔧 API endpoint: http://localhost:${PORT}/api/manifest/{videoId}.m3u8`);
    console.log(`\n⚡ Race Strategy:`);
    console.log(`   1. youtube.js (web)     ┐`);
    console.log(`   2. youtube.js (android) ├─ Race → First success wins`);
    console.log(`   3. youtube.js (tv)      │`);
    console.log(`   4. yt-dlp              ┘`);
    console.log(`\n💾 Cache TTL: ${CACHE_TTL}s`);
    console.log(`⏱️  Race timeout: ${RACE_TIMEOUT}ms\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
