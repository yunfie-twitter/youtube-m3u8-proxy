# 🎬 YouTube M3U8 Proxy (Hybrid)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Python Version](https://img.shields.io/badge/python-3.11-blue)](https://www.python.org/)

YouTube動画をM3U8/HLS形式でストリーミング配信するハイブリッドプロキシサーバー。**youtube.js**と**yt-dlp**を組み合わせた二段構えの戦略で、高速かつ確実な動画配信を実現します。

## ✨ 主な特徴

### 🚀 ハイブリッド戦略

```
Client Request
    ↓
┌─────────────────────────────────┐
│  Node.js API (youtube.js)       │  ← 高速: InnerTube API
│  ├─ HLS/DASH manifest チェック   │
│  ├─ ある → 即座に返す ✓         │
│  └─ ない → 次の手段へ...        │
└─────────────────────────────────┘
    ↓ (フォールバック)
┌─────────────────────────────────┐
│  Python API (yt-dlp)            │  ← 確実: yt-dlp 抽出
│  └─ m3u8/formats を抽出         │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  Redis Cache                    │  ← 結果をキャッシュ
│  └─ TTL: 1時間 (設定可能)       │
└─────────────────────────────────┘
```

### 💡 利点

- ⚡ **高速レスポンス** - youtube.jsで即座にチェック、成功率90%+
- 🛡️ **高信頼性** - youtube.jsが失敗してもyt-dlpでカバー
- 💾 **スマートキャッシング** - Redis使用で重複リクエストを削減
- 🔧 **API不要** - YouTubeの公式APIキーやクォータ制限なし
- 🐳 **Docker対応** - docker-composeで一発起動

## 🏗️ アーキテクチャ

| サービス | 技術 | 役割 |
|---------|------|------|
| **API Server** | Node.js + Fastify + youtube.js | メインAPI、高速manifest取得 |
| **yt-dlp Service** | Python + FastAPI + yt-dlp | フォールバック、確実な抽出 |
| **Cache** | Redis | 結果キャッシング、パフォーマンス向上 |

## 🚀 クイックスタート

### Docker Compose (推奨)

```bash
# リポジトリをクローン
git clone https://github.com/yunfie-twitter/youtube-m3u8-proxy.git
cd youtube-m3u8-proxy

# 全サービスを起動
docker-compose up -d

# ログを確認
docker-compose logs -f

# 停止
docker-compose down
```

サーバーが起動したら `http://localhost:3000` でデモページにアクセスできます。

### 手動セットアップ

#### 必要環境
- Node.js >= 18.0.0
- Python >= 3.11
- Redis

#### ステップ1: Redis起動

```bash
# Docker使用
docker run -d -p 6379:6379 redis:7-alpine

# または、ローカルインストール
redis-server
```

#### ステップ2: yt-dlp API起動

```bash
cd ytdlp-service
pip install -r requirements.txt
python app.py
# → http://localhost:8080 で起動
```

#### ステップ3: Node.js API起動

```bash
npm install
PORT=3000 YTDLP_API_URL=http://localhost:8080 npm start
# → http://localhost:3000 で起動
```

## 📖 使い方

### API エンドポイント

#### 1. M3U8マニフェスト取得 (ハイブリッド)

```
GET /api/manifest/{videoId}.m3u8
```

**処理フロー:**
1. キャッシュをチェック → あれば即返す
2. youtube.jsで取得試行 → 成功すればキャッシュして返す
3. 失敗した場合yt-dlpで取得 → 成功すればキャッシュして返す

**例:**
```bash
curl http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8
```

#### 2. 動画情報取得

```
GET /api/info/{videoId}
```

**レスポンス例:**
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 212,
  "manifestType": "hls",
  "manifestUrl": "https://...",
  "source": "youtube.js",
  "cached": false
}
```

#### 3. キャッシュクリア

```
DELETE /api/cache/{videoId}
```

#### 4. 統計情報

```
GET /api/stats
```

**レスポンス例:**
```json
{
  "cacheSize": 42,
  "maxCacheSize": 1000,
  "cacheTTL": 3600,
  "redisStatus": "ready"
}
```

#### 5. ヘルスチェック

```
GET /health
```

**レスポンス例:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-04T05:13:00.000Z",
  "services": {
    "innertube": true,
    "redis": true,
    "ytdlp": true
  }
}
```

### プレイヤーでの使用例

#### Video.js

```html
<video id="player" class="video-js" controls></video>
<script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
<script>
  videojs('player', {
    sources: [{
      src: 'http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8',
      type: 'application/x-mpegURL'
    }]
  });
</script>
```

#### HLS.js

```javascript
const hls = new Hls();
hls.loadSource('http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8');
hls.attachMedia(document.getElementById('video'));
```

## ⚙️ 設定

### 環境変数

#### Node.js API

```bash
PORT=3000                      # APIポート
HOST=0.0.0.0                   # バインドアドレス
YTDLP_API_URL=http://ytdlp:8080  # yt-dlp APIのURL
CACHE_TTL=3600                 # キャッシュ有効期限(秒)
CACHE_MAX_SIZE=1000            # 最大キャッシュ数
REDIS_HOST=redis               # Redisホスト
REDIS_PORT=6379                # Redisポート
```

#### yt-dlp API

```bash
PORT=8080                      # APIポート
WORKERS=4                      # Uvicornワーカー数
```

### docker-compose.yml カスタマイズ

```yaml
services:
  api:
    environment:
      - CACHE_TTL=7200        # 2時間キャッシュ
      - CACHE_MAX_SIZE=5000   # 最大5000件
    ports:
      - "8080:3000"           # 外部ポート変更
```

## 🛠️ 開発

### ローカル開発環境

```bash
# ホットリロード付きで起動
npm run dev
```

### Docker Compose コマンド

```bash
# 起動
docker-compose up -d

# 停止
docker-compose down

# 再起動
docker-compose restart

# ログ表示
docker-compose logs -f api      # Node.js API
docker-compose logs -f ytdlp    # yt-dlp service
docker-compose logs -f redis    # Redis

# サービス単体で再ビルド
docker-compose up -d --build api
```

## 📊 パフォーマンス

### ベンチマーク (目安)

| シナリオ | レスポンス時間 | 成功率 |
|----------|---------------|--------|
| キャッシュヒット | ~5ms | 100% |
| youtube.js (初回) | 200-500ms | 90%+ |
| yt-dlp (フォールバック) | 1-3秒 | 95%+ |

### キャッシュ戦略

- **TTL**: デフォルト1時間 (動画情報は頻繁に変わらないため)
- **LRU**: 最大サイズ到達時、最も古いエントリを削除
- **キー**: `manifest:{videoId}`

## 🐳 Docker

### イメージサイズ

- Node.js API: ~200MB (Alpine ベース)
- yt-dlp Service: ~400MB (Python + ffmpeg)
- Redis: ~30MB (Alpine)

### プロダクション環境

```bash
# docker-compose.prod.yml を使用
docker-compose -f docker-compose.prod.yml up -d
```

## 🛡️ セキュリティ

### 推奨設定

- リバースプロキシ(Nginx/Traefik)の背後に配置
- レート制限の実装
- HTTPS/TLS の使用
- 信頼できるネットワークからのアクセスのみ許可

## ⚠️ 注意事項

- このツールは教育目的で作成されています
- YouTube利用規約に従って使用してください
- 商用利用する場合は適切なライセンスを確認してください
- 大量のリクエストを送信しないでください
- サーバーリソースを適切に管理してください

## 🤝 コントリビューション

Pull Requestsは歓迎します!以下の手順で貢献できます:

1. このリポジトリをフォーク
2. 新しいブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを作成

## 📄 ライセンス

MITライセンスの下で公開されています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 🙏 謝辞

- [YouTube.js](https://github.com/LuanRT/YouTube.js) - 素晴らしいYouTubeクライアントライブラリ
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - 信頼性の高い動画ダウンローダー
- [Fastify](https://www.fastify.io/) - 高速で効率的なWebフレームワーク
- [FastAPI](https://fastapi.tiangolo.com/) - モダンなPython Webフレームワーク

## 📮 お問い合わせ

質問や提案がある場合は、[Issues](https://github.com/yunfie-twitter/youtube-m3u8-proxy/issues)で気軽にお知らせください。

---

Made with ❤️ by [yunfie](https://github.com/yunfie-twitter)
