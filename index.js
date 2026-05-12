import * as core from "@actions/core";
import { performWhitelist, performUnwhitelist } from "./lib.js";

const location = core.getInput("location");
const clusterId = core.getInput("cluster_id");
const cidr = core.getInput("cidr");
const whitelist = core.getInput("whitelist") === "true";
const name = core.getInput("name");

const cluster = { location, clusterId };

if (whitelist) {
  performWhitelist(cidr, name, cluster).catch((err) => {
    core.setFailed(err);
  });
} else {
  performUnwhitelist(cidr, cluster).catch((err) => {
    core.setFailed(err);
  });
}
