---
description: "Docs for the sst.Function construct in the @serverless-stack/resources package"
---

import config from "../../config";

A replacement for the [`cdk.lambda.NodejsFunction`](https://docs.aws.amazon.com/cdk/api/latest/docs/aws-lambda-nodejs-readme.html) that allows you to [develop your Lambda functions locally](live-lambda-development.md). Supports ES and TypeScript out-of-the-box. It also applies a couple of defaults:

- Sets the default memory setting to 1024MB.
- Sets the default Lambda function timeout to 10 seconds.
- [Enables AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html) by default so you can trace your serverless applications.
- `AWS_NODEJS_CONNECTION_REUSE_ENABLED` is turned on. Meaning that the Lambda function will automatically reuse TCP connections when working with the AWS SDK. [Read more about this here](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/node-reusing-connections.html).
- Sets the `IS_LOCAL` environment variable for the Lambda function when it is invoked locally through the `sst start` command.

## Initializer

```ts
new Function(scope: Construct, id: string, props: FunctionProps)
```

_Parameters_

- scope [`Construct`](https://docs.aws.amazon.com/cdk/api/latest/docs/constructs.Construct.html)
- id `string`
- props [`FunctionProps`](#functionprops)

## Examples

### Creating a Function

```js
import { Function } from "@serverless-stack/resources";

new Function(this, "MySnsLambda", {
  handler: "src/sns/index.main",
});
```

### Disabling bundling

```js
new Function(this, "MySnsLambda", {
  bundle: false,
  srcPath: "src/",
  handler: "sns/index.main",
});
```

In this case, SST will zip the entire `src/` directory for the Lambda function.

### Configuring bundling

```js
new Function(this, "MySnsLambda", {
  bundle: {
    externalModules: ["fsevents"],
    nodeModules: ["uuid"],
    loader: {
      ".png": "dataurl",
    },
    copyFiles: [{ from: "public", to: "." }],
    commandHooks: {
      beforeBundling: (inputDir, outputDir): string[] => {
        return [ "echo beforeBundling" ];
      },
      beforeInstall: (inputDir, outputDir): string[] => {
        return [ "echo beforeInstall" ];
      },
      afterBundling: (inputDir, outputDir): string[] => {
        return [ "echo afterBundling" ];
      },
    },
  },
  handler: "src/sns/index.main",
});
```

### Setting additional props

Use the [`cdk.lambda.FunctionOptions`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda.FunctionOptions.html) to set additional props.

```js
new Function(this, "MyApiLambda", {
  handler: "src/api.main",
  timeout: 10,
  environment: {
    TABLE_NAME: "notes",
  },
});
```

### Handling a Dead Letter Queue

```js {5}
const queue = new Queue(this, "MyDLQ");

new Function(this, "MyApiLambda", {
  handler: "src/api.main",
  deadLetterQueue: queue.sqsQueue,
});
```

### Using SSM values as environment variables

```js
import { StringParameter } from "@aws-cdk/aws-ssm";

const apiKey = StringParameter.valueFromLookup(this, "my_api_key");

new Function(this, "MyApiLambda", {
  handler: "src/api.main",
  environment: {
    API_KEY: apiKey,
  },
});
```

The `API_KEY` environment variable can be accessed as `process.env.API_KEY` within the Lambda function.

### Use the IS_LOCAL environment variable

```js
export async function main(event) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: `Hello, World! Are we running locally: ${!!process.env.IS_LOCAL}`,
  };
}
```

## Properties

Refer to the properties made available by [`cdk.lambda.Function`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda.Function.html#properties).

## Default Properties

If you have properties that need to be applied to all the functions in your app, they can be set on the App construct using the [`setDefaultFunctionProps`](constructs/App.md#specifying-default-function-props) method.

## Methods

An instance of `Function` contains the following methods.

### attachPermissions

```ts
attachPermissions(permissions: Permissions)
```

_Parameters_

- **permissions** [`Permissions`](../util/Permissions.md#permissions)

Attaches the given list of [permissions](../util/Permissions.md#permissions) to the function. This method makes it easy to control the permissions you want the function to have access to. It can range from complete access to all AWS resources, all the way to a specific permission for a resource.

Let's look at this in detail. Below are the many ways to attach permissions. Starting with the most permissive option.

Start with a simple function.

```js
const fun = new Function(this, "Function", { handler: "src/lambda.main" });
```

1. Giving full permissions

   ```js
   fun.attachPermissions(PermissionType.ALL);
   ```

   This allows the function admin access to all resources.

2. Access to a list of services

   ```js
   fun.attachPermissions(["s3", "dynamodb"]);
   ```

   Specify a list of AWS resource types that this function has complete access to. Takes a list of strings.

3. Access to a list of constructs

   ```js
   import * as sns from "@aws-cdk/aws-sns";

   const sns = new sns.Topic(this, "Topic");
   const table = new Table(this, "Table");

   fun.attachPermissions([sns, table]);
   ```

   Specify which resource constructs you want to give complete access to. Currently supports:

   - [Api](Api.md)
   - [Topic](Topic.md)
   - [Table](Table.md)
   - [Queue](Queue.md)
   - [Bucket](Bucket.md)
   - [Function](Function.md)
   - [ApolloApi](ApolloApi.md)
   - [AppSyncApi](AppSyncApi.md)
   - [KinesisStream](KinesisStream.md)
   - [WebSocketApi](WebSocketApi.md)
   - [ApiGatewayV1Api](ApiGatewayV1Api.md)
   - [cdk.aws-sns.Topic](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-sns.Topic.html)
   - [cdk.aws-s3.Bucket](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-s3.Bucket.html)
   - [cdk.aws-sqs.Queue](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-sqs.Queue.html)
   - [cdk.aws-dynamodb.Table](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-dynamodb.Table.html)

   To add to this list, please <a href={ `${config.github}/issues/new` }>open a new issue</a>.

4. Access to a list of specific permissions in a construct

   ```js
   import * as dynamodb from "@aws-cdk/aws-dynamodb";

   const sns = new sns.Topic(this, "Topic");
   const table = new dynamodb.Table(this, "Table");

   fun.attachPermissions([
     [topic, "grantPublish"],
     [table, "grantReadData"],
   ]);
   ```

   Specify which permission in the construct you want to give access to. Specified as a tuple of construct and a grant permission function.

   CDK constructs have methods of the format _grantX_ that allow you to grant specific permissions. So in the example above, the grant functions are: [`Topic.grantPublish`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-sns.Topic.html#grantwbrpublishgrantee) and [`Table.grantReadData`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-dynamodb.Table.html#grantwbrreadwbrdatagrantee). The `attachPermissions` method, takes the construct and calls the grant permission function specified.

   Unlike option #3, this supports all the CDK constructs.

5. A list of IAM policies

   ```js
   import * as iam from "@aws-cdk/aws-iam";

   fun.attachPermissions([
     new iam.PolicyStatement({
       actions: ["s3:*"],
       effect: iam.Effect.ALLOW,
       resources: [
         bucket.bucketArn + "/private/${cognito-identity.amazonaws.com:sub}/*",
       ],
     }),
     new iam.PolicyStatement({
       actions: ["execute-api:Invoke"],
       effect: iam.Effect.ALLOW,
       resources: [
         `arn:aws:execute-api:${region}:${account}:${api.httpApiId}/*`,
       ],
     }),
   ]);
   ```

   The [`cdk.aws-iam.PolicyStatement`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-iam.PolicyStatement.html) allows you to craft granular IAM policies that you can attach to the function.

## FunctionProps

Takes the following construct props in addition to the [`cdk.lambda.FunctionOptions`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda.FunctionOptions.html).

### handler

_Type_ : `string`

#### Node.js runtime

Path to the entry point and handler function. Uses the format, `/path/to/file.function`. Where the first part is the path to the file, followed by the name of the function that's exported in that file.

For example, if your handler file is in `src/lambda.js` and it exported a function called `main`. The `handler` would be `src/lambda.main`.

First checks for a `.ts` file and then for a `.js` file.

If the [`srcPath`](#srcpath) is set, then the path to the `handler` is relative to it. So if the `srcPath` is set to `src`. Then `lambda.main` as the `handler` would mean that the file is in `src/lambda.js` (or `.ts`).

#### Python runtime

Path to the entry point and handler function relative to the [`srcPath`](#srcpath). Uses the format, `path/to/file.function`. Where the first part is the path to the file, followed by the name of the function that's exported in that file.

For example, if your `srcPath` is `src/`, your handler file is in `src/lambda.py`, and it exported a function called `main`. The `handler` would be `lambda.main`.

#### Go runtime

Path to the handler function. Uses the format, `/path/to/file.go` or just `/path/to`.

If the [`srcPath`](#srcpath) is set, then the path to the `handler` is relative to it. So if the `srcPath` is set to `src`. Then `lambda.go` as the `handler` would mean that the file is in `src/lambda.go`.

### bundle?

_Type_ : `boolean | FunctionBundleProps`, _defaults to_ `true`

Bundles your Lambda functions with [esbuild](https://esbuild.github.io). Turn this off if you have npm packages that cannot be bundled. Currently bundle cannot be disabled if the `srcPath` is set to the project root. [Read more about this here](https://github.com/serverless-stack/serverless-stack/issues/78).

If you wanted to configure the bundling process, you can pass in the [FunctionBundleProps](#functionbundleprops).

Only supported for the **Node.js** runtimes.

### srcPath?

_Type_ : `string`, _defaults to the project root_

#### Node.js runtime

The directory that needs to zipped up as the Lambda function package. Only applicable if the [`bundle`](#bundle) option is set to `false`.

Note that for TypeScript functions, if the `srcPath` is not the project root, SST expects the `tsconfig.json` to be in this directory.

#### Python runtime

For Python functions, `srcPath` is required. This is the directory where the `requirements.txt`, `Pipfile`, or `poetry.lock` is expected.

Note that for Python functions, you'll need to have Docker installed. While building and deploying, this construct will handle installing all the required modules in a [Lambda compatible Docker container](https://github.com/aws/aws-sam-build-images/tree/develop/build-image-src) according to the runtime. This esnures that the Python Lambda functions are packaged correctly.

#### Go runtime

The directory where `go.mod` is found.

### memorySize?

_Type_ : `number`, _defaults to 1024_

The amount of memory in MB allocated to this function.

### timeout?

_Type_ : `number | cdk.core.Duration`, _defaults to 10_

The function execution timeout in seconds. You can pass in the timeout as a `number` or as [`cdk.core.Duration`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_core.Duration.html).

### runtime?

_Type_ : `string | cdk.lambda.Runtime`, _defaults to_ `nodejs12.x`

The runtime environment. You can pass in the runtime as a `string` or as [`cdk.lambda.Runtime`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda.Runtime.html). Only runtimes of the Node.js, Go, and Python family are supported.

### tracing?

_Type_ : [`cdk.lambda.Tracing`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda.Tracing.html), _defaults to_ `cdk.lambda.Tracing.ACTIVE`

Turns on [AWS X-RAY for the Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html), to enable tracing.

### permissions?

_Type_ : [`Permissions`](../util/Permissions.md#permissions), _defaults to_ `cdk.lambda.Tracing.ACTIVE`

Attaches the given list of [permissions](../util/Permissions.md#permissions) to the function. Configuring this property is equivalent to calling [`attachPermissions`](#attachpermissions) after the function is created.

## FunctionDefinition

_Type_ : `string | Function | FunctionProps`

All the high-level SST constructs that create a function internally accepts this as a type. So you can define a function by passing in the [handler](#handler) as a string:

```
"src/create.main"
```

Or the [`FunctionProps`](#functionprops):

```js
{
  bundle: false,
  srcPath: "src/",
  handler: "sns/index.main",
}
```

Or an instance of the Function itself.

```js
new Function(this, "Create", {
  handler: "src/create.main",
});
```

## FunctionBundleProps

### loader?

_Type_ : `{ [string]: esbuild.Loader }`, _defaults to_ `{}`

Use loaders to change how a given input file is interpreted.

Configuring a loader for a given file type lets you load that file type with an import statement or a require call.

### externalModules?

_Type_ : `string[]`, _defaults to_ `['aws-sdk']`

A list of modules that should be considered as externals. This usually applies to ones that are already available in the runtime or are provided separately as a Lambda Layer.

### nodeModules?

_Type_ : `string[]`, _defaults to all modules are bundled_

A list of modules that should not be bundled but instead included in the `node_modules` folder of the Lambda package. This is useful when working with native dependencies or when `esbuild` fails to bundle a module.

Note that the modules listed in `nodeModules` must be present in the `package.json`'s dependencies. The same version will be used for installation. The lock file (yarn.lock or package-lock.json) will be used along with the right installer (yarn or npm).

### copyFiles?

_Type_ : [`FunctionBundleCopyFilesProps[]`](#functionbundlecopyfilesprops), _defaults to_ `[]`

### commandHooks?

_Type_ : [`cdk.aws-lambda-nodejs.ICommandHooks`](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda-nodejs.ICommandHooks.html), _defaults to no command hooks_

## FunctionBundleCopyFilesProps

### from

_Type_ : `string`

The path to the file or folder relative to the `srcPath`.

### to

_Type_ : `string`

The path in the Lambda function package the file or folder to be copied to.
