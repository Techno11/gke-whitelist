import { HttpClient } from "@actions/http-client";
import { google } from "googleapis";

const USER_AGENT = "gke-whitelist";

function clusterUrl(projectId, cluster) {
  const { location, clusterId } = cluster;
  return `https://container.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/clusters/${clusterId}`;
}

function authHeaders(authClient) {
  return {
    Authorization: "OAuth " + authClient,
  };
}

/**
 * Whitelist an IP range on a GKE private cluster master.
 * @param {string} cidr
 * @param {string} displayName
 * @param {{ location: string, clusterId: string }} cluster
 */
export async function performWhitelist(cidr, displayName, cluster) {
  const projectId = await google.auth.getProjectId();
  const authClient = await authorize();
  const newBlock = { displayName, cidrBlock: cidr };
  const current = await getCidrs(projectId, authClient, cluster);
  current.push(newBlock);
  await updateCidrs(projectId, authClient, current, cluster);
}

/**
 * Remove a CIDR block from GKE private cluster master authorized ranges.
 * @param {string} cidrBlock
 * @param {{ location: string, clusterId: string }} cluster
 */
export async function performUnwhitelist(cidrBlock, cluster) {
  const projectId = await google.auth.getProjectId();
  const authClient = await authorize();
  const filtered = (await getCidrs(projectId, authClient, cluster)).filter(
    (entry) => entry.cidrBlock !== cidrBlock
  );
  await updateCidrs(projectId, authClient, filtered, cluster);
}

/**
 * @returns {Promise<string>}
 */
export async function authorize() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return await auth.getAccessToken();
}

/**
 * @param {string} projectId
 * @param {string} authClient
 * @param {{ location: string, clusterId: string }} cluster
 */
export async function getCidrs(projectId, authClient, cluster) {
  const client = new HttpClient(USER_AGENT);
  const url = clusterUrl(projectId, cluster);
  const { result } = await client.getJson(url, authHeaders(authClient));
  if (!result?.masterAuthorizedNetworksConfig?.cidrBlocks) {
    throw new Error("Unexpected cluster response shape");
  }
  return result.masterAuthorizedNetworksConfig.cidrBlocks;
}

/**
 * @param {string} projectId
 * @param {string} authClient
 * @param {Array<{ displayName?: string, cidrBlock: string }>} cidrsToSend
 * @param {{ location: string, clusterId: string }} cluster
 */
export async function updateCidrs(projectId, authClient, cidrsToSend, cluster) {
  const client = new HttpClient(USER_AGENT);
  const url = clusterUrl(projectId, cluster);
  const body = {
    update: {
      desiredMasterAuthorizedNetworksConfig: {
        enabled: true,
        cidrBlocks: cidrsToSend,
      },
    },
    name: `projects/${projectId}/locations/${cluster.location}/clusters/${cluster.clusterId}`,
  };
  await client.putJson(url, body, authHeaders(authClient));
}
