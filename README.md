# 🎬 YouTube M3U8 Proxy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

YouTube動画をM3U8/HLS形式でストリーミング配信するプロキシサーバー。[YouTube.js](https://github.com/LuanRT/YouTube.js)を使用し、APIキー不要でYouTube動画をHLS形式で配信できます。

## ✨ 特徴

- 🔑 **APIキー不要** - YouTubeの公式APIキーやクォータ制限なしで動作
- 🎥 **HLS/M3U8対応** - Video.jsなどのHLSプレイヤーで再生可能
- ⚡ **高速** - Fastifyを使用した高パフォーマンスなプロキシ
- 🌐 **CORS対応** - あらゆるドメインからのアクセスが可能
- 📱 **レスポンシブ** - デモページ付きで即座にテスト可能
- 🎯 **複数品質対応** - アダプティブストリーミングに対応

## 🚀 クイックスタート

### 必要環境

- Node.js >= 18.0.0
- npm または yarn

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/yunfie-twitter/youtube-m3u8-proxy.git
cd youtube-m3u8-proxy

# 依存関係をインストール
npm install

# サーバーを起動
npm start
```

サーバーが起動したら、ブラウザで `http://localhost:3000` にアクセスしてデモページを確認できます。

## 📖 使い方

### API エンドポイント

#### 1. M3U8マニフェストを取得

```
GET /api/manifest/{videoId}.m3u8
```

**例:**
```bash
curl http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8
```

#### 2. 動画情報を取得

```
GET /api/info/{videoId}
```

**レスポンス例:**
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "author": "Rick Astley",
  "duration": 212,
  "viewCount": 1400000000,
  "thumbnail": "https://...",
  "isLive": false
}
```

#### 3. ヘルスチェック

```
GET /health
```

### プレイヤーでの使用例

#### Video.js

```html
<!DOCTYPE html>
<html>
<head>
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
</head>
<body>
  <video id="player" class="video-js" controls></video>
  
  <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
  <script>
    const player = videojs('player', {
      sources: [{
        src: 'http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8',
        type: 'application/x-mpegURL'
      }]
    });
  </script>
</body>
</html>
```

#### HLS.js

```html
<!DOCTYPE html>
<html>
<body>
  <video id="video" controls></video>
  
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script>
    const video = document.getElementById('video');
    const hls = new Hls();
    hls.loadSource('http://localhost:3000/api/manifest/dQw4w9WgXcQ.m3u8');
    hls.attachMedia(video);
  </script>
</body>
</html>
```

## ⚙️ 設定

環境変数で動作をカスタマイズできます:

```bash
# ポート番号 (デフォルト: 3000)
PORT=3000

# ホスト (デフォルト: 0.0.0.0)
HOST=0.0.0.0
```

**例:**
```bash
PORT=8080 HOST=127.0.0.1 npm start
```

## 🐳 Docker

Dockerを使用して簡単にデプロイできます:

```bash
# Dockerイメージをビルド
docker build -t youtube-m3u8-proxy .

# コンテナを起動
docker run -p 3000:3000 youtube-m3u8-proxy
```

## 📝 開発

開発モード(ホットリロード付き)で起動:

```bash
npm run dev
```

## 🛠️ 技術スタック

- [YouTube.js](https://github.com/LuanRT/YouTube.js) - YouTube私的APIクライアント
- [Fastify](https://www.fastify.io/) - 高速Webフレームワーク
- [Video.js](https://videojs.com/) - HTMLビデオプレイヤー

## ⚠️ 注意事項

- このツールは教育目的で作成されています
- YouTubeの利用規約に従って使用してください
- 商用利用する場合は適切なライセンスを確認してください
- 大量のリクエストを送信しないでください

## 🤝 コントリビューション

Pull Requestsは歓迎します！以下の手順で貢献できます:

1. このリポジトリをフォーク
2. 新しいブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを作成

## 📄 ライセンス

MITライセンスの下で公開されています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 🙏 謝辞

- [YouTube.js](https://github.com/LuanRT/YouTube.js) - 素晴らしいYouTubeクライアントライブラリ
- [Fastify](https://www.fastify.io/) - 高速で効率的なWebフレームワーク

## 📮 お問い合わせ

質問や提案がある場合は、[Issues](https://github.com/yunfie-twitter/youtube-m3u8-proxy/issues)で気軽にお知らせください。

---

Made with ❤️ by [yunfie](https://github.com/yunfie-twitter)
