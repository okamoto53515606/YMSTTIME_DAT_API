import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class YmstStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda 関数（コンテナイメージ）
    // ビルドコンテキスト = ワークスペースルート（YTCMST/ を含むため）
    const fn = new lambda.DockerImageFunction(this, 'YmstApiFunction', {
      functionName: 'ymst-api',
      description: 'Yamato Master Pack API (postcode / leadtime)',
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, '..', '..'), // workspace root
        {
          file: 'app/Dockerfile',
          // cdk.out / node_modules をステージングから除外して ENAMETOOLONG を防ぐ
          exclude: [
            'cdk',
            '.git',
            'app/node_modules',
            'app/dist',
            'prompt_history',
          ],
          ignoreMode: cdk.IgnoreMode.GLOB,
        }
      ),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      // コールドスタート後はデータがメモリ上にキャッシュされるため
      // 追加の環境変数は不要（デフォルトで DATA_DIR = dist/../YTCMST）
      environment: {
        LOG_LEVEL: 'info',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      architecture: lambda.Architecture.X86_64,
    });

    // Lambda Function URL（IAM 認証）
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.GET],
        allowedHeaders: ['*'],
        maxAge: cdk.Duration.hours(1),
      },
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    // Function URL を出力
    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
      description: 'Yamato Master API endpoint (IAM 認証)',
      exportName: 'YmstApiFunctionUrl',
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      value: fn.functionName,
      description: 'Lambda 関数名',
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: fn.functionArn,
      description: 'Lambda 関数 ARN',
    });
  }
}
