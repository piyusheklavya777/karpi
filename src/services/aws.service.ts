// src/services/aws.service.ts

import {
  EC2Client,
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  type Instance,
} from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-providers";
import type { IAWSProfile, IAWSInstance, IAWSFetchResult } from "../types";
import { storageService } from "./storage.service";
import { logger } from "../utils/logger";

// ═══════════════════════════════════════════════════════════════════════════════
// AWS Regions
// ═══════════════════════════════════════════════════════════════════════════════

export const AWS_REGIONS = [
  { value: "us-east-1", name: "US East (N. Virginia)" },
  { value: "us-east-2", name: "US East (Ohio)" },
  { value: "us-west-1", name: "US West (N. California)" },
  { value: "us-west-2", name: "US West (Oregon)" },
  { value: "eu-west-1", name: "EU (Ireland)" },
  { value: "eu-west-2", name: "EU (London)" },
  { value: "eu-west-3", name: "EU (Paris)" },
  { value: "eu-central-1", name: "EU (Frankfurt)" },
  { value: "eu-north-1", name: "EU (Stockholm)" },
  { value: "ap-south-1", name: "Asia Pacific (Mumbai)" },
  { value: "ap-southeast-1", name: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", name: "Asia Pacific (Sydney)" },
  { value: "ap-northeast-1", name: "Asia Pacific (Tokyo)" },
  { value: "ap-northeast-2", name: "Asia Pacific (Seoul)" },
  { value: "ap-northeast-3", name: "Asia Pacific (Osaka)" },
  { value: "sa-east-1", name: "South America (São Paulo)" },
  { value: "ca-central-1", name: "Canada (Central)" },
  { value: "me-south-1", name: "Middle East (Bahrain)" },
  { value: "af-south-1", name: "Africa (Cape Town)" },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// AWS Service Class
// ═══════════════════════════════════════════════════════════════════════════════

class AWSService {
  /**
   * Create an EC2 client with the given AWS profile credentials
   */
  private createEC2Client(awsProfile: IAWSProfile, region?: string): EC2Client {
    const targetRegion = region || awsProfile.default_region;

    if (awsProfile.auth_type === "cli_profile" && awsProfile.cli_profile_name) {
      // Use AWS CLI profile
      return new EC2Client({
        region: targetRegion,
        credentials: fromIni({ profile: awsProfile.cli_profile_name }),
      });
    } else if (
      awsProfile.auth_type === "access_keys" &&
      awsProfile.access_key_id &&
      awsProfile.secret_access_key
    ) {
      // Use direct access keys
      return new EC2Client({
        region: targetRegion,
        credentials: {
          accessKeyId: awsProfile.access_key_id,
          secretAccessKey: awsProfile.secret_access_key,
        },
      });
    }

    throw new Error("Invalid AWS profile configuration");
  }

  /**
   * Fetch EC2 instances from AWS
   */
  async fetchEC2Instances(
    awsProfileId: string,
    region?: string
  ): Promise<IAWSFetchResult> {
    const awsProfile = storageService.getAWSProfile(awsProfileId);
    if (!awsProfile) {
      return {
        success: false,
        instances: [],
        error: "AWS profile not found",
        region: region || "unknown",
      };
    }

    const targetRegion = region || awsProfile.default_region;

    try {
      const client = this.createEC2Client(awsProfile, targetRegion);
      const command = new DescribeInstancesCommand({});
      const response: DescribeInstancesCommandOutput = await client.send(
        command
      );

      const instances: IAWSInstance[] = [];
      const existingServers = storageService.getAllServers();

      // Process reservations and instances
      if (response.Reservations) {
        for (const reservation of response.Reservations) {
          if (reservation.Instances) {
            for (const instance of reservation.Instances) {
              const awsInstance = this.mapEC2Instance(instance);

              // Check if this instance is already imported
              const existingServer = existingServers.find(
                (s) =>
                  s.host === awsInstance.public_ip ||
                  s.aws_instance_id === awsInstance.instance_id
              );

              if (existingServer) {
                awsInstance.is_imported = true;
                awsInstance.existing_server_id = existingServer.id;
              }

              instances.push(awsInstance);
            }
          }
        }
      }

      // Update last_used timestamp
      storageService.updateAWSProfile(awsProfileId, {
        last_used: new Date().toISOString(),
      });

      logger.debug(
        `Fetched ${instances.length} EC2 instances from ${targetRegion}`
      );

      return {
        success: true,
        instances,
        region: targetRegion,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to fetch EC2 instances: ${errorMessage}`);

      return {
        success: false,
        instances: [],
        error: errorMessage,
        region: targetRegion,
      };
    }
  }

  /**
   * Map AWS SDK Instance to our IAWSInstance interface
   */
  private mapEC2Instance(instance: Instance): IAWSInstance {
    // Get instance name from tags
    const nameTag = instance.Tags?.find((tag) => tag.Key === "Name");
    const name = nameTag?.Value || instance.InstanceId || "Unnamed Instance";

    // Build tags record
    const tags: Record<string, string> = {};
    if (instance.Tags) {
      for (const tag of instance.Tags) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }
    }

    // Get security group names
    const securityGroups =
      instance.SecurityGroups?.map(
        (sg) => sg.GroupName || sg.GroupId || ""
      ).filter(Boolean) || [];

    return {
      instance_id: instance.InstanceId || "",
      name,
      public_ip: instance.PublicIpAddress,
      private_ip: instance.PrivateIpAddress,
      state: (instance.State?.Name as IAWSInstance["state"]) || "stopped",
      instance_type: instance.InstanceType || "unknown",
      key_name: instance.KeyName,
      launch_time: instance.LaunchTime?.toISOString() || "",
      vpc_id: instance.VpcId,
      subnet_id: instance.SubnetId,
      security_groups: securityGroups,
      tags,
      is_imported: false,
    };
  }

  /**
   * Test AWS credentials by making a simple API call
   */
  async testCredentials(
    awsProfile: IAWSProfile
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.createEC2Client(awsProfile);
      // Just describe instances with max results of 1 to test credentials
      const command = new DescribeInstancesCommand({ MaxResults: 5 });
      await client.send(command);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get suggested SSH username based on AMI or tags
   */
  getSuggestedUsername(instance: IAWSInstance): string {
    // Check for username in tags
    if (instance.tags["ssh-user"] || instance.tags["SshUser"]) {
      return instance.tags["ssh-user"] || instance.tags["SshUser"];
    }

    // Default usernames based on common AMIs
    const name = instance.name.toLowerCase();
    if (name.includes("ubuntu")) return "ubuntu";
    if (name.includes("amazon") || name.includes("amzn")) return "ec2-user";
    if (name.includes("centos")) return "centos";
    if (name.includes("debian")) return "admin";
    if (name.includes("rhel") || name.includes("redhat")) return "ec2-user";
    if (name.includes("suse")) return "ec2-user";
    if (name.includes("fedora")) return "fedora";
    if (name.includes("bitnami")) return "bitnami";

    // Default to ec2-user (most common)
    return "ec2-user";
  }

  /**
   * Get suggested PEM file path based on key name
   */
  getSuggestedPemPath(instance: IAWSInstance): string {
    if (!instance.key_name) return "";
    return `~/.ssh/${instance.key_name}.pem`;
  }
}

// Export singleton instance
export const awsService = new AWSService();
