/**
 * @jest-environment node
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const mockGetJson = jest.fn();
const mockPutJson = jest.fn();

await jest.unstable_mockModule("@actions/http-client", () => ({
  HttpClient: jest.fn(() => ({
    getJson: mockGetJson,
    putJson: mockPutJson,
  })),
}));

await jest.unstable_mockModule("googleapis", () => ({
  google: {
    auth: {
      getProjectId: jest.fn(),
      GoogleAuth: jest.fn(),
    },
  },
}));

const { google } = await import("googleapis");
const {
  getCidrs,
  updateCidrs,
  performWhitelist,
  performUnwhitelist,
} = await import("../lib.js");

const cluster = { location: "us-central1", clusterId: "my-cluster" };

const clusterApiUrl =
  "https://container.googleapis.com/v1beta1/projects/proj-1/locations/us-central1/clusters/my-cluster";

beforeEach(() => {
  jest.clearAllMocks();
  google.auth.getProjectId.mockResolvedValue("proj-1");
  const mockGetAccessToken = jest.fn().mockResolvedValue("access-token");
  google.auth.GoogleAuth.mockImplementation(() => ({
    getAccessToken: mockGetAccessToken,
  }));
});

describe("getCidrs", () => {
  it("returns cidr blocks from the cluster API", async () => {
    mockGetJson.mockResolvedValue({
      statusCode: 200,
      result: {
        masterAuthorizedNetworksConfig: {
          cidrBlocks: [
            { displayName: "a", cidrBlock: "10.0.0.0/8" },
            { displayName: "b", cidrBlock: "192.168.0.0/16" },
          ],
        },
      },
      headers: {},
    });

    const blocks = await getCidrs("proj-1", "tok", cluster);

    expect(blocks).toEqual([
      { displayName: "a", cidrBlock: "10.0.0.0/8" },
      { displayName: "b", cidrBlock: "192.168.0.0/16" },
    ]);
    expect(mockGetJson).toHaveBeenCalledWith(
      clusterApiUrl,
      expect.objectContaining({
        Authorization: "OAuth tok",
      })
    );
  });

  it("throws when the API returns a non-200 status", async () => {
    mockGetJson.mockRejectedValue(new Error("403"));

    await expect(getCidrs("proj-1", "tok", cluster)).rejects.toThrow("403");
  });
});

describe("updateCidrs", () => {
  it("sends a PUT with desired master authorized networks", async () => {
    mockPutJson.mockResolvedValue({
      statusCode: 200,
      result: {},
      headers: {},
    });

    await updateCidrs(
      "proj-1",
      "tok",
      [{ displayName: "x", cidrBlock: "1.2.3.4/32" }],
      cluster
    );

    expect(mockPutJson).toHaveBeenCalledWith(
      clusterApiUrl,
      {
        update: {
          desiredMasterAuthorizedNetworksConfig: {
            enabled: true,
            cidrBlocks: [{ displayName: "x", cidrBlock: "1.2.3.4/32" }],
          },
        },
        name: "projects/proj-1/locations/us-central1/clusters/my-cluster",
      },
      expect.objectContaining({
        Authorization: "OAuth tok",
      })
    );
  });

  it("throws when the update returns a non-200 status", async () => {
    mockPutJson.mockRejectedValue(new Error("500"));

    await expect(
      updateCidrs("proj-1", "tok", [], cluster)
    ).rejects.toThrow("500");
  });
});

describe("performWhitelist", () => {
  it("appends a new CIDR and PUTs the merged list", async () => {
    mockGetJson.mockResolvedValueOnce({
      statusCode: 200,
      result: {
        masterAuthorizedNetworksConfig: {
          cidrBlocks: [{ displayName: "old", cidrBlock: "10.0.0.0/8" }],
        },
      },
      headers: {},
    });
    mockPutJson.mockResolvedValueOnce({
      statusCode: 200,
      result: {},
      headers: {},
    });

    await performWhitelist("203.0.113.0/24", "CI runner", cluster);

    expect(mockGetJson).toHaveBeenCalledTimes(1);
    expect(mockPutJson).toHaveBeenCalledTimes(1);
    const payload = mockPutJson.mock.calls[0][1];
    expect(
      payload.update.desiredMasterAuthorizedNetworksConfig.cidrBlocks
    ).toEqual([
      { displayName: "old", cidrBlock: "10.0.0.0/8" },
      { displayName: "CI runner", cidrBlock: "203.0.113.0/24" },
    ]);
  });
});

describe("performUnwhitelist", () => {
  it("removes the matching CIDR and PUTs the rest", async () => {
    mockGetJson.mockResolvedValueOnce({
      statusCode: 200,
      result: {
        masterAuthorizedNetworksConfig: {
          cidrBlocks: [
            { displayName: "keep", cidrBlock: "10.0.0.0/8" },
            { displayName: "drop", cidrBlock: "203.0.113.5/32" },
          ],
        },
      },
      headers: {},
    });
    mockPutJson.mockResolvedValueOnce({
      statusCode: 200,
      result: {},
      headers: {},
    });

    await performUnwhitelist("203.0.113.5/32", cluster);

    const payload = mockPutJson.mock.calls[0][1];
    expect(
      payload.update.desiredMasterAuthorizedNetworksConfig.cidrBlocks
    ).toEqual([{ displayName: "keep", cidrBlock: "10.0.0.0/8" }]);
  });
});
