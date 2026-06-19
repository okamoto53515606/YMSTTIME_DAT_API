# ヤマトマスタパック API

> **ヤマトの最短お届け日を、郵便番号2つと出荷日を渡すだけで取得できる API です。**  
> AWS Lambda 上で動作し、`cdk deploy` 1コマンドで自社 AWS アカウントにデプロイできます。

---

## EC サイトでの利用シーン

```
【商品ページ】
  「この商品は明日（6/21 午前中）お届け可能」
       ↑ 倉庫の郵便番号 + お客様の郵便番号 + 最短出荷予定日 → このAPIで算出

【カート画面】
  配送先入力後にリアルタイムで最短着日を表示 → 購入意欲アップ

【注文確認・完了画面】
  「出荷予定日：6/20、最短お届け日：6/22 午前中」を明示
       ↑ 注文確定時に確定した出荷予定日ベースで正確な日付を表示

【管理画面・出荷業務】
  出荷指示書への印字、配達不可エリアの事前チェック
```

---

## なぜこのAPIが必要か

ヤマト運輸は「マスタパック」という配達日数データを提供していますが、そのまま使うには課題があります。

| 課題 | 内容 |
|------|------|
| ファイル形式が難解 | 固定長テキスト（Shift_JIS）、約20MB・61万件 |
| 毎回読み込めない | リクエストのたびにDATファイルを解析すると遅すぎる |
| 定期更新が必要 | ヤマトから月次でDLして反映する運用が要る |

**このAPIはこれを解決します。**

- 起動時に全データをメモリ（Map）に展開 → 検索は O(1)、数ms で応答
- `GET` リクエスト1本で最短お届け日まで返す
- マスタ更新は DATファイルを差し替えて `cdk deploy` するだけ

---

## システム概要

### 5分でわかるデプロイの全体像

```
あなたがやること：
  1. ヤマトからDATファイルをDL → YTCMST/ フォルダに置く
  2. cdk deploy を実行（約3〜5分）

自動で起きること：
  ┌─────────────────────────────────────────┐
  │ CDK が Docker イメージをビルド            │
  │   └─ DATファイルをイメージに焼き込み      │
  │ ECR（AWSのDockerレジストリ）にpush        │
  │ Lambda を新しいイメージで更新             │
  │ HTTPS エンドポイント（Function URL）を発行 │
  └─────────────────────────────────────────┘

EC サイトから使うとき：
  PHPコード → HTTPS リクエスト → Lambda → JSON レスポンス
                （SigV4署名、SDKが自動でやってくれる）
```

### インフラ構成

```
[ヤマトビジネスメンバーズ]
        ↓ マスタパックDL（週次）
[YTCMST/ フォルダ（ローカル）]
        ↓ cdk deploy でイメージに焼き付け
[Amazon ECR（コンテナレジストリ）]
        ↓
[AWS Lambda（コンテナイメージ / 512 MB）]
  ├─ 起動時に YMSTPOST.DAT（142,792件）を Map に展開
  └─ 起動時に YMSTTIME.DAT（473,340件）を Map に展開
        ↓
[Lambda Function URL（HTTPS エンドポイント）]
        ↓
[EC サイト / 業務システム]
```

### スペック

| 項目 | 内容 |
|------|------|
| ランタイム | Node.js 20 + Fastify / Lambda Web Adapter |
| メモリ | 512 MB |
| コールドスタート | 約3〜5秒（2回目以降は約1秒） |
| 認証 | AWS SigV4（PHP SDK が自動署名、コード追加不要） |
| リージョン | ap-northeast-1（東京）※環境変数で変更可 |

### コスト目安

| 用途 | 月間リクエスト数 | 月額コスト目安 |
|------|-----------------|--------------|
| 小規模 EC | 〜10 万回 | **ほぼ無料**（Lambda 無料枠内） |
| 中規模 EC | 100 万回 | 約 $0.20（約 30 円） |
| 大規模 EC | 1,000 万回 | 約 $2（約 300 円） |

> Lambda は月 100 万リクエスト・40 万 GB-秒まで永久無料です。

### マスタファイル

| ファイル | 件数 | 用途 |
|---------|------|------|
| YMSTPOST.DAT | 約 142,000 件 | 郵便番号 → 仕分コード |
| YMSTTIME.DAT | 約 473,000 件 | 発ベース＋着仕分コード → リードタイム |

---

## API 仕様

### 共通

| 項目 | 値 |
|------|----|
| ベース URL | `cdk deploy` 後に Outputs に表示される Function URL |
| 認証 | AWS Signature Version 4（サービス名: `lambda`） |
| レスポンス形式 | JSON |

> **認証について（難しくありません）**  
> AWS の API キーを使った署名方式です。PHP なら `aws/aws-sdk-php` が自動で署名してくれるため、コードの変更は最小限です。

---

### API① 郵便番号から仕分コード検索

```
GET /yamato/postcode/{zip}
```

郵便番号から「どの配送拠点（ベースNo）を経由するか」を返します。  
通常は API② を使えば OK です。デバッグや独自ロジックに使います。

#### パラメータ

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| zip | path string | 郵便番号 7 桁（ハイフンなし） |

#### レスポンス例

```json
{
  "zip": "1860002",
  "sort_code": "0335501",
  "base_no": "033",
  "updated_at": "20231205"
}
```

---

### API② 最短お届け日検索（メインAPI）

```
GET /yamato/leadtime?from_zip={発送元}&to_zip={発送先}&ship_date={出荷予定日}
```

**EC サイトで使うのはほぼこちらです。** 発送元・発送先・出荷日を渡すと、最短着日と受取時間帯を返します。

#### パラメータ

| パラメータ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| from_zip | string | 倉庫（発送元）の郵便番号 7 桁 | `1860002` |
| to_zip | string | お客様（発送先）の郵便番号 7 桁 | `9040004` |
| ship_date | string | 出荷予定日（YYYY-MM-DD） | `2026-06-20` |

> **注意（PHPの場合は自動処理）:** クエリパラメータはアルファベット昇順（`from_zip` → `ship_date` → `to_zip`）で渡してください。`aws/aws-sdk-php` を使う場合は自動でソートされるため意識不要です。

#### レスポンス例

```json
{
  "from_zip": "1860002",
  "to_zip": "9040004",
  "ship_date": "2026-06-20",
  "from_base_no": "033",
  "to_sort_code": "09851",
  "delivery_days": 3,
  "earliest_delivery_date": "2026-06-22",
  "earliest_time_from": "08",
  "earliest_time_to": "20",
  "deliverable": true
}
```

#### フィールド説明

| フィールド | 説明 |
|-----------|------|
| `delivery_days` | 最短配達日数（2=翌日、3=翌々日…11=配達不可） |
| `earliest_delivery_date` | **EC サイトに表示する最短着日**（ship_date + delivery_days − 1 日） |
| `earliest_time_from` | 受取開始時間帯（`08`=午前中、`14`/`16`/`18`=時間帯指定、`99`=指定不可） |
| `earliest_time_to` | 受取終了時間帯（`20`=20時まで、`99`=指定不可） |
| `deliverable` | 配達可否（`delivery_days` ≠ 11 のとき `true`） |

#### エラーレスポンス

| ステータス | 状況 |
|-----------|------|
| 400 | パラメータ形式不正（zip が 7 桁でないなど） |
| 404 | 郵便番号または発着組み合わせが未登録 |

---

## セットアップ手順

### 0. リポジトリのクローン

```bash
git clone https://github.com/okamoto53515606/YMSTTIME_DAT_API.git
cd YMSTTIME_DAT_API
```

### 前提条件

- Node.js 20 以上
- AWS CDK v2（`npm install -g aws-cdk`）
- Docker（デプロイ時のイメージビルドに使用）
- AWS CLI（`aws configure` でプロファイル設定済み）

### 1. マスタファイルの準備

1. [ヤマトビジネスメンバーズ](https://bmypage.kuronekoyamato.co.jp/) にログイン
2. 「マスタパックダウンロード」から最新版をダウンロード
3. 以下のファイルを `YTCMST/` フォルダに配置

```
YTCMST/
├── YMSTPOST.DAT   # 必須
├── YMSTTIME.DAT   # 必須
├── YMSTAREA.DAT   # 参考
├── YMSTJIS5.DAT   # 参考
└── YMSTMTRX.DAT   # 参考
```

> **YTCMST/ は `.gitignore` に登録済みです。** `git push` してもDATファイルは公開されません。

### 2. 依存関係のインストール

```bash
cd app && npm install && cd ..
cd cdk && npm install && cd ..
```

### 3. CDK Bootstrap（初回のみ）

AWSアカウントに CDK 用のS3バケット等を作成する初回設定です。一度やれば以降は不要です。

```bash
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1

cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-1 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

### 4. CDK デプロイ

```bash
cd cdk
export AWS_PROFILE=your-profile
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk deploy --require-approval never
```

3〜5分後に完了し、エンドポイント URL が表示されます。

```
Outputs:
YmstStack.FunctionUrl = https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/
```

> **リージョンについて:** デフォルトは東京（`ap-northeast-1`）です。`AWS_REGION` 環境変数で変更できます。

---

## 利用方法

### PHP（推奨）

`aws/aws-sdk-php` が SigV4 署名を自動で処理します。

```bash
composer require aws/aws-sdk-php guzzlehttp/guzzle
```

```php
<?php
require __DIR__ . '/vendor/autoload.php';

use Aws\Credentials\CredentialProvider;
use Aws\Signature\SignatureV4;
use GuzzleHttp\Client;
use GuzzleHttp\Psr7\Request;

$functionUrl = 'https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws';
$region      = 'ap-northeast-1';

// 認証情報（環境変数 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY から自動取得）
$credentials = CredentialProvider::defaultProvider()()->wait();

// クエリパラメータ（ksort でアルファベット昇順に並べる）
$params = [
    'from_zip'  => '1860002',   // 倉庫の郵便番号
    'ship_date' => '2026-06-20', // 出荷予定日
    'to_zip'    => '9040004',   // お客様の郵便番号
];
ksort($params);

$uri     = $functionUrl . '/yamato/leadtime?' . http_build_query($params);
$request = new Request('GET', $uri, ['Accept' => 'application/json']);

// SigV4 署名（SDKが自動処理）
$signedRequest = (new SignatureV4('lambda', $region))->signRequest($request, $credentials);

$response = (new Client())->send($signedRequest);
$data     = json_decode($response->getBody()->getContents(), true);

if ($data['deliverable']) {
    echo "最短お届け日: {$data['earliest_delivery_date']}\n"; // → 2026-06-22
    echo "時間帯: {$data['earliest_time_from']}時〜{$data['earliest_time_to']}時\n"; // → 08時〜20時
} else {
    echo "配達不可のエリアです\n";
}
```

---

### .NET (C#)

外部 NuGet パッケージ不要。.NET 標準ライブラリのみで動作します。

#### 0. .NET 10 SDK のインストール（未導入の場合）

```powershell
winget install Microsoft.DotNet.SDK.10
```

PowerShell を再起動して `dotnet --version` が `10.0.xxx` と表示されれば OK。

#### 1. プロジェクト作成

```powershell
New-Item -ItemType Directory -Name ymst-test
Set-Location ymst-test
dotnet new console
```

#### 2. Program.cs をまるごと書き換える

```csharp
// 外部 NuGet パッケージ不要・.NET 標準ライブラリのみ使用
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const string FunctionUrl = "https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws";
const string Region      = "ap-northeast-1";

var accessKey = Environment.GetEnvironmentVariable("AWS_ACCESS_KEY_ID")
    ?? throw new Exception("環境変数 AWS_ACCESS_KEY_ID が未設定です");
var secretKey = Environment.GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY")
    ?? throw new Exception("環境変数 AWS_SECRET_ACCESS_KEY が未設定です");

// クエリパラメータはアルファベット昇順（SigV4 の要件）
var uri     = new Uri($"{FunctionUrl}/yamato/leadtime?from_zip=1860002&ship_date=2026-06-20&to_zip=9040004");
var now     = DateTime.UtcNow;
var amzDate = now.ToString("yyyyMMddTHHmmssZ");
var date    = now.ToString("yyyyMMdd");

// SigV4 署名
var payloadHash  = Hex(SHA256.HashData([]));
var canonicalReq = string.Join("\n",
    "GET", uri.AbsolutePath, uri.Query.TrimStart('?'),
    $"host:{uri.Host}\nx-amz-date:{amzDate}\n",
    "host;x-amz-date", payloadHash);

var scope        = $"{date}/{Region}/lambda/aws4_request";
var stringToSign = string.Join("\n",
    "AWS4-HMAC-SHA256", amzDate, scope,
    Hex(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalReq))));

var sigKey    = Hmac(Hmac(Hmac(Hmac(Encoding.UTF8.GetBytes("AWS4" + secretKey), date), Region), "lambda"), "aws4_request");
var signature = Hex(Hmac(sigKey, stringToSign));

// リクエスト送信
using var client = new HttpClient();
var req = new HttpRequestMessage(HttpMethod.Get, uri);
req.Headers.TryAddWithoutValidation("Authorization",
    $"AWS4-HMAC-SHA256 Credential={accessKey}/{scope}, SignedHeaders=host;x-amz-date, Signature={signature}");
req.Headers.Add("x-amz-date", amzDate);

var sw  = System.Diagnostics.Stopwatch.StartNew();
var res = await client.SendAsync(req);
sw.Stop();

var body = await res.Content.ReadAsStringAsync();
if (!res.IsSuccessStatusCode) { Console.WriteLine($"エラー {(int)res.StatusCode}: {body}"); return; }

var d = JsonDocument.Parse(body).RootElement;
Console.WriteLine($"最短お届け日 : {d.GetProperty("earliest_delivery_date").GetString()}");
Console.WriteLine($"時間帯       : {d.GetProperty("earliest_time_from").GetString()}時〜{d.GetProperty("earliest_time_to").GetString()}時");
Console.WriteLine($"配達日数     : {d.GetProperty("delivery_days").GetInt32()}日");
Console.WriteLine($"レスポンス   : {sw.ElapsedMilliseconds} ms");

static string Hex(byte[] b) => Convert.ToHexString(b).ToLower();
static byte[] Hmac(byte[] key, string data) => new HMACSHA256(key).ComputeHash(Encoding.UTF8.GetBytes(data));
```

#### 3. 環境変数をセットして実行

```powershell
$env:AWS_ACCESS_KEY_ID     = "AKIA..."
$env:AWS_SECRET_ACCESS_KEY = "your-secret-key"
dotnet run
```

#### 実行結果

```
最短お届け日 : 2026-06-22
時間帯       : 08時〜20時
配達日数     : 3日
レスポンス   : 920 ms
```

---

### curl（動作確認・デバッグ用）

```bash
export AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile your-profile)
export AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile your-profile)
FUNC_URL="https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws"

# API② 最短お届け日検索（-d の順序はアルファベット順で固定）
curl -s \
  --aws-sigv4 "aws:amz:ap-northeast-1:lambda" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -G \
  -d "from_zip=1860002" \
  -d "ship_date=2026-06-20" \
  -d "to_zip=9040004" \
  -w "\n--- timing ---\nTTFB: %{time_starttransfer}s  total: %{time_total}s\n" \
  "${FUNC_URL}/yamato/leadtime"
```

---

## マスタ更新手順

ヤマトからマスタパックが更新されたら（目安：週次）、以下の手順で反映します。

```bash
# 1. 新しい DAT ファイルを YTCMST/ に上書き配置
# 2. 再デプロイ（約3〜5分）
cd cdk && npx cdk deploy --require-approval never
```

---

## やり残し：デプロイ自動化

> 現時点では未実装。マスタ更新のたびに手動で CDK デプロイを実行する運用。

### 目標

S3 に `YTCMST.zip` を PUT するだけで Lambda が自動更新される仕組み。

### 想定フロー

```
[ヤマトビジネスメンバーズからDL]
        ↓
[S3 バケットに YTCMST.zip を PUT]
        ↓ S3 イベント通知
[CodeBuild プロジェクト 自動起動]
        ↓ ビルド処理
  1. GitHub から最新ソースを取得
     (https://github.com/okamoto53515606/YMSTTIME_DAT_API)
  2. S3 から YTCMST.zip をダウンロード
  3. ZIP を展開して YTCMST/ に DAT ファイルを配置
  4. npx cdk deploy --require-approval never
        ↓
[ECR にイメージ push → Lambda 更新]
```

### 実装タスク（CDK 追加分）

| # | タスク | 備考 |
|---|--------|------|
| 1 | S3 バケット作成（マスタ受け取り用） | バージョニング有効推奨 |
| 2 | CodeBuild プロジェクト作成 | ソース: GitHub、環境変数で S3 バケット名を渡す |
| 3 | `buildspec.yml` 作成 | ZIP 展開 → CDK デプロイのステップを記述 |
| 4 | S3 PUT イベント → CodeBuild 起動の EventBridge ルール設定 | |
| 5 | CodeBuild 実行ロールに ECR・Lambda・CloudFormation 権限を付与 | |
