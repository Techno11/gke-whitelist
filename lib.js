import { google } from "googleapis";

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
  const { location, clusterId } = cluster;
  const resp = await globalThis.fetch(
    `https://container.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/clusters/${clusterId}`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "OAuth " + authClient,
      },
    }
  );
  if (resp.status !== 200) throw new Error(String(resp.status));
  const json = await resp.json();
  return json.masterAuthorizedNetworksConfig.cidrBlocks;
}

/**
 * @param {string} projectId
 * @param {string} authClient
 * @param {Array<{ displayName?: string, cidrBlock: string }>} cidrsToSend
 * @param {{ location: string, clusterId: string }} cluster
 */
export async function updateCidrs(projectId, authClient, cidrsToSend, cluster) {
  const { location, clusterId } = cluster;
  const payload = JSON.stringify({
    update: {
      desiredMasterAuthorizedNetworksConfig: {
        enabled: true,
        cidrBlocks: cidrsToSend,
      },
    },
    name: `projects/${projectId}/locations/${location}/clusters/${clusterId}`,
  });
  const updateResp = await globalThis.fetch(
    `https://container.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/clusters/${clusterId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "OAuth " + authClient,
      },
      body: payload,
    }
  );
  if (updateResp.status !== 200) throw new Error(String(updateResp.status));
}
