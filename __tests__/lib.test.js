/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

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

const originalFetch = globalThis.fetch;

/** @type {jest.Mock} */
let fetchMock;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
  google.auth.getProjectId.mockResolvedValue("proj-1");
  const mockGetAccessToken = jest.fn().mockResolvedValue("access-token");
  google.auth.GoogleAuth.mockImplementation(() => ({
    getAccessToken: mockGetAccessToken,
  }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getCidrs", () => {
  it("returns cidr blocks from the cluster API", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        masterAuthorizedNetworksConfig: {
          cidrBlocks: [
            { displayName: "a", cidrBlock: "10.0.0.0/8" },
            { displayName: "b", cidrBlock: "192.168.0.0/16" },
          ],
        },
      }),
    });

    const blocks = await getCidrs("proj-1", "tok", cluster);

    expect(blocks).toEqual([
      { displayName: "a", cidrBlock: "10.0.0.0/8" },
      { displayName: "b", cidrBlock: "192.168.0.0/16" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://container.googleapis.com/v1beta1/projects/proj-1/locations/us-central1/clusters/my-cluster",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "OAuth tok",
        }),
      })
    );
  });

  it("throws when the API returns a non-200 status", async () => {
    fetchMock.mockResolvedValue({ status: 403 });

    await expect(getCidrs("proj-1", "tok", cluster)).rejects.toThrow("403");
  });
});

describe("updateCidrs", () => {
  it("sends a PUT with desired master authorized networks", async () => {
    fetchMock.mockResolvedValue({ status: 200 });

    await updateCidrs(
      "proj-1",
      "tok",
      [{ displayName: "x", cidrBlock: "1.2.3.4/32" }],
      cluster
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://container.googleapis.com/v1beta1/projects/proj-1/locations/us-central1/clusters/my-cluster",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "OAuth tok",
          "Content-Type": "application/json",
        }),
      })
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      update: {
        desiredMasterAuthorizedNetworksConfig: {
          enabled: true,
          cidrBlocks: [{ displayName: "x", cidrBlock: "1.2.3.4/32" }],
        },
      },
      name: "projects/proj-1/locations/us-central1/clusters/my-cluster",
    });
  });

  it("throws when the update returns a non-200 status", async () => {
    fetchMock.mockResolvedValue({ status: 500 });

    await expect(
      updateCidrs("proj-1", "tok", [], cluster)
    ).rejects.toThrow("500");
  });
});

describe("performWhitelist", () => {
  it("appends a new CIDR and PUTs the merged list", async () => {
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          masterAuthorizedNetworksConfig: {
            cidrBlocks: [{ displayName: "old", cidrBlock: "10.0.0.0/8" }],
          },
        }),
      })
      .mockResolvedValueOnce({ status: 200 });

    await performWhitelist("203.0.113.0/24", "CI runner", cluster);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    const payload = JSON.parse(putCall[1].body);
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
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          masterAuthorizedNetworksConfig: {
            cidrBlocks: [
              { displayName: "keep", cidrBlock: "10.0.0.0/8" },
              { displayName: "drop", cidrBlock: "203.0.113.5/32" },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ status: 200 });

    await performUnwhitelist("203.0.113.5/32", cluster);

    const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    const payload = JSON.parse(putCall[1].body);
    expect(
      payload.update.desiredMasterAuthorizedNetworksConfig.cidrBlocks
    ).toEqual([{ displayName: "keep", cidrBlock: "10.0.0.0/8" }]);
  });
});
