# Crypto Monitor

Bitbank の公開 API から BTC、BCC、TRX、RENDER、CHZ、DAI の JPY 相場を表示する、iPhone ブラウザ向けの静的 Web アプリです。

## 起動

このディレクトリで `python3 -m http.server 8000` を実行し、ブラウザで `http://localhost:8000` を開きます。iPhone から使う場合は HTTPS 対応の静的ホスティングへ、このディレクトリのファイルを配置してください。

## 操作

- 一覧は 1日から1年までの期間を選択でき、期間変動率の高い順に並びます。
- 銘柄を選ぶとローソク足を表示します。分足、時間足、日足、週足、月足を複数選択できます。
- チャート上をドラッグすると過去へ移動、ピンチすると拡大縮小、長押しすると価格と時刻の十字線が表示されます。
- 「0基準」を押すと価格ゼロを含む縦軸に切り替わり、ゼロの線を確認できます。
- API キーは設定画面からこのブラウザの `localStorage` に保存できます。公開相場の取得にキーは送信されません。

Bitbank API: `https://public.bitbank.cc/{pair}/ticker` および `https://public.bitbank.cc/{pair}/candlestick/{type}/{date}`。ブラウザから Bitbank への接続が必要です。
