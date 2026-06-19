#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { YmstStack } from '../lib/ymst-stack';

const app = new cdk.App();

new YmstStack(app, 'YmstStack', {
  env: {
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'Yamato Master Pack API – Lambda Web Adapter + Function URL',
});
