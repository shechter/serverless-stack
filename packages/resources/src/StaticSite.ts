import * as path from "path";
import { execSync } from "child_process";

import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as s3Assets from "@aws-cdk/aws-s3-assets";
import * as acm from "@aws-cdk/aws-certificatemanager";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";
import * as route53 from "@aws-cdk/aws-route53";
import * as route53Patterns from "@aws-cdk/aws-route53-patterns";
import * as route53Targets from "@aws-cdk/aws-route53-targets";
import * as cf from "@aws-cdk/aws-cloudfront";
import * as cfOrigins from "@aws-cdk/aws-cloudfront-origins";
import { AwsCliLayer } from "@aws-cdk/lambda-layer-awscli";

import { App } from "./App";

export enum StaticSiteErrorOptions {
  REDIRECT_TO_INDEX_PAGE = "REDIRECT_TO_INDEX_PAGE",
}

export interface StaticSiteProps {
  readonly path: string;
  readonly indexPage?: string;
  readonly errorPage?: string | StaticSiteErrorOptions;
  readonly buildCommand?: string;
  readonly buildOutput?: string;
  readonly fileOptions?: StaticSiteFileOption[];
  readonly replaceValues?: StaticSiteReplaceProps[];
  readonly customDomain?: string | StaticSiteDomainProps;
  readonly s3Bucket?: s3.BucketProps;
  readonly cfDistribution?: StaticSiteCdkDistributionProps;
}

export interface StaticSiteDomainProps {
  readonly domainName: string;
  readonly domainAlias?: string;
  readonly hostedZone?: string | route53.IHostedZone;
  readonly certificate?: acm.ICertificate;
}

export interface StaticSiteFileOption {
  readonly exclude: string | string[];
  readonly include: string | string[];
  readonly cacheControl: string;
}

export interface StaticSiteReplaceProps {
  readonly files: string;
  readonly search: string;
  readonly replace: string;
}

export interface StaticSiteCdkDistributionProps
  extends Omit<cf.DistributionProps, "defaultBehavior"> {
  readonly defaultBehavior?: cf.AddBehaviorOptions;
}

export class StaticSite extends cdk.Construct {
  public readonly s3Bucket: s3.Bucket;
  public readonly cfDistribution: cf.Distribution;
  public readonly hostedZone?: route53.IHostedZone;
  public readonly acmCertificate?: acm.ICertificate;
  private readonly props: StaticSiteProps;

  constructor(scope: cdk.Construct, id: string, props: StaticSiteProps) {
    super(scope, id);

    // Handle remove (ie. sst remove)
    const root = scope.node.root as App;
    const isSstStart = root.local;
    const skipBuild = root.skipBuild;

    this.props = props;

    this.s3Bucket = this.createS3Bucket();
    const handler = this.createCustomResourceFunction();
    const asset = this.buildApp(handler, isSstStart, skipBuild);
    const deployId = isSstStart ? `deploy-live` : `deploy-${asset.assetHash}`;

    this.hostedZone = this.lookupHostedZone();
    this.acmCertificate = this.createCertificate();
    this.cfDistribution = this.createCfDistribution(deployId, isSstStart);
    this.createRoute53Records();
    this.createS3Deployment(deployId, handler, asset);
  }

  public get url(): string {
    return `https://${this.cfDistribution.distributionDomainName}`;
  }

  public get customDomainUrl(): string | undefined {
    const { customDomain } = this.props;
    if (!customDomain) {
      return;
    }

    if (typeof customDomain === "string") {
      return `https://${customDomain}`;
    } else {
      return `https://${customDomain.domainName}`;
    }
  }

  public get bucketArn(): string {
    return this.s3Bucket.bucketArn;
  }

  public get bucketName(): string {
    return this.s3Bucket.bucketName;
  }

  public get distributionId(): string {
    return this.cfDistribution.distributionId;
  }

  public get distributionDomain(): string {
    return this.cfDistribution.distributionDomainName;
  }

  private createS3Bucket(): s3.Bucket {
    let { s3Bucket } = this.props;
    s3Bucket = s3Bucket || {};

    // Validate s3Bucket
    if (s3Bucket.websiteIndexDocument) {
      throw new Error(
        `Do not configure the "s3Bucket.websiteIndexDocument". Use the "indexPage" to configure the StaticSite index page.`
      );
    }

    if (s3Bucket.websiteErrorDocument) {
      throw new Error(
        `Do not configure the "s3Bucket.websiteErrorDocument". Use the "errorPage" to configure the StaticSite index page.`
      );
    }

    return new s3.Bucket(this, "Bucket", {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      ...s3Bucket,
    });
  }

  private createCustomResourceFunction(): lambda.Function {
    const handler = new lambda.Function(this, "CustomResourceHandler", {
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../assets/StaticSite/custom-resource")
      ),
      layers: [new AwsCliLayer(this, "AwsCliLayer")],
      runtime: lambda.Runtime.PYTHON_3_6,
      handler: "index.handler",
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
    });

    this.s3Bucket.grantReadWrite(handler);

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudfront:GetInvalidation",
          "cloudfront:CreateInvalidation",
        ],
        resources: ["*"],
      })
    );

    return handler;
  }

  private buildApp(
    handler: lambda.Function,
    isSstStart: boolean,
    skipBuild: boolean
  ): s3Assets.Asset {
    const { path: sitePath, buildCommand } = this.props;
    const buildOutput = this.props.buildOutput || ".";

    // Validate handler role exists
    const handlerRole = handler.role;
    if (!handlerRole) {
      throw new Error("lambda.Function should have created a Role");
    }

    let asset;

    // Local development or skip build => stub asset
    if (isSstStart || skipBuild) {
      asset = new s3Assets.Asset(this, "Asset", {
        path: path.resolve(__dirname, "../assets/StaticSite/stub"),
      });
      asset.grantRead(handlerRole);
    }

    // Build and package user's website
    else {
      // build
      if (buildCommand) {
        try {
          execSync(buildCommand, {
            cwd: sitePath,
            stdio: "inherit",
          });
        } catch (e) {
          throw new Error(
            `There was a problem building the "${this.node.id}" StaticSite.`
          );
        }
      }
      // create asset
      asset = new s3Assets.Asset(this, "Asset", {
        path: path.join(sitePath, buildOutput),
      });
      asset.grantRead(handlerRole);
    }

    return asset;
  }

  private lookupHostedZone(): route53.IHostedZone | undefined {
    const { customDomain } = this.props;

    if (!customDomain) {
      return;
    }

    let hostedZone;

    if (typeof customDomain === "string") {
      hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: customDomain,
      });
    } else if (typeof customDomain.hostedZone === "string") {
      hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: customDomain.hostedZone,
      });
    } else if (typeof customDomain.domainName === "string") {
      hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: customDomain.domainName,
      });
    } else {
      hostedZone = customDomain.hostedZone as route53.IHostedZone;
    }

    return hostedZone;
  }

  private createCertificate(): acm.ICertificate | undefined {
    const { customDomain } = this.props;

    if (!customDomain || !this.hostedZone) {
      return;
    }

    let acmCertificate;

    if (typeof customDomain === "string") {
      acmCertificate = new acm.DnsValidatedCertificate(this, "Certificate", {
        domainName: customDomain,
        hostedZone: this.hostedZone,
        region: "us-east-1",
      });
    } else if (customDomain.certificate) {
      acmCertificate = customDomain.certificate;
    } else {
      acmCertificate = new acm.DnsValidatedCertificate(this, "Certificate", {
        domainName: customDomain.domainName,
        hostedZone: this.hostedZone,
        region: "us-east-1",
      });
    }

    return acmCertificate;
  }

  private createCfDistribution(
    deployId: string,
    isSstStart: boolean
  ): cf.Distribution {
    const { cfDistribution, customDomain } = this.props;
    const indexPage = this.props.indexPage || "index.html";
    const errorPage = this.props.errorPage;

    const cfDistributionProps = cfDistribution || {};

    // Validate input
    if (cfDistributionProps.certificate) {
      throw new Error(
        `Do not configure the "cfDistribution.certificate". Use the "customDomain" to configure the StaticSite domain certificate.`
      );
    }
    if (cfDistributionProps.domainNames) {
      throw new Error(
        `Do not configure the "cfDistribution.domainNames". Use the "customDomain" to configure the StaticSite domain.`
      );
    }

    // Build domainNames
    const domainNames = [];
    if (!customDomain) {
      // no domain
    } else if (typeof customDomain === "string") {
      domainNames.push(customDomain);
    } else {
      domainNames.push(customDomain.domainName);
    }

    // Build errorResponses
    let errorResponses;
    // case: sst start => showing stub site, and redirect all routes to the index page
    if (isSstStart) {
      errorResponses = this.buildErrorResponsesForRedirectToIndex(indexPage);
    } else if (errorPage) {
      if (cfDistributionProps.errorResponses) {
        throw new Error(
          `Cannot configure the "cfDistribution.errorResponses" when "errorPage" is passed in. Use one or the other to configure the behavior for error pages.`
        );
      }

      errorResponses =
        errorPage === StaticSiteErrorOptions.REDIRECT_TO_INDEX_PAGE
          ? this.buildErrorResponsesForRedirectToIndex(indexPage)
          : this.buildErrorResponsesFor404ErrorPage(errorPage);
    }

    // Create CF distribution
    return new cf.Distribution(this, "Distribution", {
      // these values can be overwritten by cfDistributionProps
      defaultRootObject: indexPage,
      errorResponses,
      ...cfDistributionProps,
      // these values can NOT be overwritten by cfDistributionProps
      domainNames,
      certificate: this.acmCertificate,
      defaultBehavior: {
        origin: new cfOrigins.S3Origin(this.s3Bucket, {
          originPath: deployId,
        }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        ...(cfDistributionProps.defaultBehavior || {}),
      },
    });
  }

  private createRoute53Records(): void {
    const { customDomain } = this.props;

    if (!customDomain || !this.hostedZone) {
      return;
    }

    let recordName;
    let domainAlias;
    if (typeof customDomain === "string") {
      recordName = customDomain;
    } else {
      recordName = customDomain.domainName;
      domainAlias = customDomain.domainAlias;
    }

    // Create DNS record
    new route53.ARecord(this, "AliasRecord", {
      recordName,
      zone: this.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.cfDistribution)
      ),
    });

    // Create Alias redirect record
    if (domainAlias) {
      new route53Patterns.HttpsRedirect(this, "Redirect", {
        zone: this.hostedZone,
        recordNames: [domainAlias],
        targetDomain: recordName,
      });
    }
  }

  private createS3Deployment(
    deployId: string,
    handler: lambda.Function,
    asset: s3Assets.Asset
  ): void {
    const { path: sitePath, fileOptions, replaceValues } = this.props;

    // Create custom resource
    new cdk.CustomResource(this, "CustomResource", {
      serviceToken: handler.functionArn,
      resourceType: "Custom::SSTBucketDeployment",
      properties: {
        SourceBucketName: asset.s3BucketName,
        SourceObjectKey: asset.s3ObjectKey,
        DestinationBucketName: this.s3Bucket.bucketName,
        DestinationBucketKeyPrefix: deployId,
        DistributionId: this.cfDistribution.distributionId,
        DistributionPaths: ["/*"],
        FileOptions: (fileOptions || []).map(
          ({ exclude, include, cacheControl }) => {
            if (typeof exclude === "string") {
              exclude = [exclude];
            }
            if (typeof include === "string") {
              include = [include];
            }
            const options = [];
            exclude.forEach((per) => options.push("--exclude", per));
            include.forEach((per) => options.push("--include", per));
            options.push("--cache-control", cacheControl);
            return options;
          }
        ),
        ReplaceValues: replaceValues || [],
      },
    });
  }

  private buildErrorResponsesForRedirectToIndex(
    indexPage: string
  ): cf.ErrorResponse[] {
    return [
      {
        httpStatus: 403,
        responsePagePath: `/${indexPage}`,
        responseHttpStatus: 200,
      },
      {
        httpStatus: 404,
        responsePagePath: `/${indexPage}`,
        responseHttpStatus: 200,
      },
    ];
  }

  private buildErrorResponsesFor404ErrorPage(
    errorPage: string
  ): cf.ErrorResponse[] {
    return [
      {
        httpStatus: 403,
        responsePagePath: `/${errorPage}`,
      },
      {
        httpStatus: 404,
        responsePagePath: `/${errorPage}`,
      },
    ];
  }
}
