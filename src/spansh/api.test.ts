import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSpanshSystemDump, searchSystemNames } from "./api";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchSystemNames", () => {
  it("calls the field_values/name endpoint through the proxy and unwraps min_max", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ min_max: [{ id64: 1797250861443, name: "Swoilz AW-C d52" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchSystemNames("Swoil");

    expect(fetchMock).toHaveBeenCalledWith("https://spansh-proxy.iotguru.dev/systems/field_values/name?q=Swoil");
    expect(results).toEqual([{ id64: 1797250861443, name: "Swoilz AW-C d52" }]);
  });

  it("returns [] when min_max is absent rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    expect(await searchSystemNames("xyz")).toEqual([]);
  });

  it("URL-encodes the query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ min_max: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await searchSystemNames("Swoil AW-C d52");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://spansh-proxy.iotguru.dev/systems/field_values/name?q=Swoil%20AW-C%20d52",
    );
  });

  it("throws a readable error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 502)));
    await expect(searchSystemNames("Swoil")).rejects.toThrow(/502/);
  });

  it("throws a readable error on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(searchSystemNames("Swoil")).rejects.toThrow(/Couldn't reach the Spansh proxy/);
  });
});

describe("fetchSpanshSystemDump", () => {
  it("calls /dump/{id64} through the proxy and unwraps the {system: {...}} envelope", async () => {
    const record = { name: "Swoilz AW-C d52", id64: 1797250861443, bodies: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ system: record }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSpanshSystemDump(1797250861443);

    expect(fetchMock).toHaveBeenCalledWith("https://spansh-proxy.iotguru.dev/dump/1797250861443");
    expect(result).toEqual(record);
  });

  it("throws a readable error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 404)));
    await expect(fetchSpanshSystemDump(1)).rejects.toThrow(/404/);
  });
});
