# Phrase Forge MVP

ことばのニュアンスを静かに積み上げる、フラッシュカードアプリです。

## 追加したこと

- Google Identity Services を使った Google ログイン
- ログインユーザーごとのローカルデータ分離
- ヘッダーバー化とハンバーガーメニュー
- Confidence の星を再タップしてゼロに戻す挙動
- 一覧は例文・訳・ニュアンス中心の表示

## Google認証について

- 設定画面で `Google Client ID` を入力すると、Googleログインボタンが表示されます。
- 静的アプリなので、今回はブラウザ内で受け取った Google のプロフィール情報を使って、ユーザーごとに `localStorage` の見え方を分けています。
- サーバー側での ID トークン検証まではしていません。公開サービスにする場合はバックエンド側の検証を追加してください。

## Web公開

- このアプリはビルド不要の静的サイトとして動きます。
- `index.html` をそのまま配信できる環境なら公開できます。
- `vercel.json` を追加してあるので、Vercel へそのまま配置しやすい構成です。
- 公開時は Google Cloud Console 側で公開URLを `Authorized JavaScript origins` に追加してください。
