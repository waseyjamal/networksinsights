import { describe, expect, it } from "vitest";
import { MESSAGES, parseNeeds, prefixFor, run } from "./logic";

const ok = (network: string, needs: string) => {
  const result = run({ network, needs });
  if (!result.ok) throw new Error(result.error);
  return result;
};
const rows = (network: string, needs: string) =>
  ok(network, needs).subnets.map(
    (s) =>
      `${s.name} ${s.network}/${s.prefix} ${s.firstHost}-${s.lastHost} ${s.broadcast} ${s.hostsAvailable}`,
  );

describe("textbook VLSM", () => {
  it("192.168.1.0/24 for 100, 50, 20 and 2 hosts", () => {
    expect(rows("192.168.1.0/24", "Sales 20\nEngineering 100\nLink 2\nOffice 50")).toEqual([
      "Engineering 192.168.1.0/25 192.168.1.1-192.168.1.126 192.168.1.127 126",
      "Office 192.168.1.128/26 192.168.1.129-192.168.1.190 192.168.1.191 62",
      "Sales 192.168.1.192/27 192.168.1.193-192.168.1.222 192.168.1.223 30",
      "Link 192.168.1.224/30 192.168.1.225-192.168.1.226 192.168.1.227 2",
    ]);
    const result = ok("192.168.1.0/24", "20\n100\n2\n50");
    expect(result.freeAddresses).toBe(28);
    expect(result.freeFrom).toBe("192.168.1.228");
    expect(result.subnets[0]?.mask).toBe("255.255.255.128");
  });

  it("172.16.0.0/16 for 1000, 500 and 250 hosts", () => {
    expect(rows("172.16.0.0/16", "250\n1000\n500")).toEqual([
      "Subnet 2 172.16.0.0/22 172.16.0.1-172.16.3.254 172.16.3.255 1022",
      "Subnet 3 172.16.4.0/23 172.16.4.1-172.16.5.254 172.16.5.255 510",
      "Subnet 1 172.16.6.0/24 172.16.6.1-172.16.6.254 172.16.6.255 254",
    ]);
  });

  it("equal needs keep the typed order", () => {
    expect(ok("10.0.0.0/24", "B 10\nA 10\nC 10").subnets.map((s) => s.name)).toEqual([
      "B",
      "A",
      "C",
    ]);
  });

  it("fills a network exactly, and refuses one host more", () => {
    const full = ok("10.0.0.0/24", "126\n62\n30\n14\n6\n2\n2");
    expect(full.freeAddresses).toBe(0);
    expect(full.freeFrom).toBeNull();
    expect(ok("10.0.0.0/30", "2").subnets[0]?.network).toBe("10.0.0.0");
    expect(run({ network: "10.0.0.0/30", needs: "Too big 3" })).toEqual({
      ok: false,
      error: MESSAGES.noRoom("Too big", "10.0.0.0/30"),
    });
    expect(run({ network: "10.0.0.0/24", needs: "126\n126\n1" })).toEqual({
      ok: false,
      error: MESSAGES.noRoom("Subnet 3", "10.0.0.0/24"),
    });
  });

  it("a network typed with host bits names its block", () => {
    const result = ok("192.168.1.77/24", "10");
    expect(result.network).toBe("192.168.1.0/24");
    expect(result.hostBitsSet).toBe("192.168.1.77/24");
    expect(result.subnets[0]?.network).toBe("192.168.1.0");
  });

  it("/0 can hold the largest subnet", () => {
    expect(rows("0.0.0.0/0", "Half 2147483646\nOne 1")).toEqual([
      "Half 0.0.0.0/1 0.0.0.1-127.255.255.254 127.255.255.255 2147483646",
      "One 128.0.0.0/30 128.0.0.1-128.0.0.2 128.0.0.3 2",
    ]);
  });
});

describe("subnet sizes", () => {
  it.each([
    [1, 30],
    [2, 30],
    [3, 29],
    [6, 29],
    [7, 28],
    [62, 26],
    [63, 25],
    [126, 25],
    [127, 24],
    [254, 24],
    [255, 23],
  ])("%i hosts need a /%i", (hosts, prefix) => {
    expect(prefixFor(hosts)).toBe(prefix);
  });
});

describe("reading the list", () => {
  it("takes names with spaces, colons or commas", () => {
    expect(parseNeeds("Sales: 50\nFloor 2 office, 20\n  7  ")).toEqual({
      ok: true,
      needs: [
        { name: "Sales", hosts: 50 },
        { name: "Floor 2 office", hosts: 20 },
        { name: "Subnet 3", hosts: 7 },
      ],
    });
  });

  it.each([
    ["", MESSAGES.noNeeds],
    ["Sales fifty", MESSAGES.badLine("Sales fifty")],
    ["Sales -5", MESSAGES.badLine("Sales -5")],
    ["Sales 0", MESSAGES.zeroHosts("Sales")],
    ["Big 4294967295", MESSAGES.tooBig("Big", 4294967295)],
    ["1\n".repeat(257), MESSAGES.tooMany],
  ])("%j is refused", (needs, error) => {
    expect(run({ network: "10.0.0.0/8", needs })).toEqual({ ok: false, error });
  });
});

describe("invalid networks", () => {
  it.each([
    ["", MESSAGES.noNetwork],
    ["10.0.0.0", MESSAGES.badNetwork],
    ["10.0.0.0/31", MESSAGES.badNetwork],
    ["10.0.0.0/32", MESSAGES.badNetwork],
    ["10.0.0.0/33", MESSAGES.badNetwork],
    ["10.0.0/8", MESSAGES.badAddress("10.0.0")],
    ["10.0.0.300/8", MESSAGES.badAddress("10.0.0.300")],
    ["010.0.0.0/8", MESSAGES.leadingZero("010.0.0.0")],
    ["2001:db8::/32", MESSAGES.badAddress("2001:db8::")],
  ])("%j is refused", (network, error) => {
    expect(run({ network, needs: "10" })).toEqual({ ok: false, error });
  });
});
