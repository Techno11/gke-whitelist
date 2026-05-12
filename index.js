const {google} = require('googleapis');
const fetch = require("node-fetch");
const core = require("@actions/core");

// Get Variables from Actions
const location = core.getInput("location");
const clusterId = core.getInput("cluster_id");
const cidr = core.getInput("cidr");
const whitelist = core.getInput("whitelist") === "true";
const name = core.getInput("name");

if (whitelist) {
  performWhitelist(cidr, name).catch((err) => {
    core.error("ERROR ERROR ERROR");
    core.setFailed(err);
  });
} else {
  performUnwhitelist(cidr).catch((err) => {
    core.setFailed(err);
  });
}

/**
 * Whitelist a ip address on GKE private cluster master
 * @param {String} cidr Ip address range to whitelist
 * @param {String} displayName name to give to the entry
 */
async function performWhitelist(cidr, displayName) {
  // Get Project and Authentication
  const projectId = await google.auth.getProjectId()
  const authClient = await authorize();
  // New Cidr Block
  const newBlock = { displayName: name, cidrBlock: cidr }
  // Get Current Blocks
  const current = await getCidrs(projectId, authClient)
  // Push new block
  current.push(newBlock);
  // Update with our new blocks
  await updateCidrs(projectId, authClient, current);
}

/**
 * Remove a cidr block from GKE private cluster master authorized ranges
 * @param {String} cidrBlock CIDR Block to remove
 */
async function performUnwhitelist(cidrBlock) {
  // Get Project and Authentication
  const projectId = await google.auth.getProjectId()
  const authClient = await authorize();
  // Get Current Cidr blocks, filter out the unwanted one, and post it back
  await updateCidrs(projectId, authClient, (await getCidrs(projectId, authClient)).filter((entry) => entry.cidrBlock !== cidrBlock));
}

/**
 * Get Access Token to send API Requests
 * @returns {Promise<string>}
 */
async function authorize() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  return await auth.getAccessToken();
}

/**
 * Get CIDR blocks on cluster
 * @param projectId Project ID
 * @param authClient API Access Token
 * @returns {Promise<container_v1.Schema$CidrBlock[] | google.container.v1.MasterAuthorizedNetworksConfig.ICidrBlock[]>}
 */
async function getCidrs(projectId, authClient) {
  const resp = await fetch(`https://container.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/clusters/${clusterId}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'OAuth ' + authClient
    }
  })
  if (resp.status !== 200) throw new Error(resp);
  const json = await resp.json();
  return json.masterAuthorizedNetworksConfig.cidrBlocks;
}

/**
 * Update CIDR blocks of a cluster
 * @param projectId Project ID
 * @param authClient API Access Token
 * @param cidrsToSend CIDR Blocks to send
 * @returns {Promise<void>}
 */
async function updateCidrs(projectId, authClient, cidrsToSend) {
  const payload = JSON.stringify({
    update: {
      desiredMasterAuthorizedNetworksConfig: {
        enabled: true,
        cidrBlocks: cidrsToSend,
      }
    },
    name: `projects/${projectId}/locations/${location}/clusters/${clusterId}`
  });
  const updateResp = await fetch(`https://container.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/clusters/${clusterId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'OAuth ' + authClient
    },
    body: payload,
  })
  if (updateResp.status !== 200) throw new Error(resp);
}
