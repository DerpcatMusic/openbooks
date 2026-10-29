import { expect, test } from "vite-plus/test";
import { crc32, zip } from "./zip.ts";

const enc = new TextEncoder();
test("crc32 of 123456789 is the standard check value", () => expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926));

test("zip: opens with unzip and returns the same bytes", async () => {
  const a = enc.encode("A000 hello\r\n"),
    b = new Uint8Array([0xe0, 0xe1, 0xe2, 0, 1, 2]);
  const z = zip([
    { name: "OPENFRMT/12345678.26/10291200/INI.TXT", data: a },
    { name: "OPENFRMT/12345678.26/10291200/BKMVDATA.TXT", data: b },
  ]);
  expect(zip([{ name: "x", data: a }])).toEqual(zip([{ name: "x", data: a }])); // deterministic
  const dir = `${process.env.TMPDIR ?? "/tmp"}/zip-test-${process.pid}`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(`${dir}/t.zip`, z);
  const t = await Bun.$`unzip -t ${dir}/t.zip`.quiet().nothrow();
  expect(t.exitCode).toBe(0);
  await Bun.$`unzip -o -q ${dir}/t.zip -d ${dir}/out`.quiet();
  expect(new Uint8Array(await Bun.file(`${dir}/out/OPENFRMT/12345678.26/10291200/BKMVDATA.TXT`).arrayBuffer())).toEqual(b);
  expect(await Bun.file(`${dir}/out/OPENFRMT/12345678.26/10291200/INI.TXT`).text()).toBe("A000 hello\r\n");
  await Bun.$`rm -rf ${dir}`.quiet();
});
