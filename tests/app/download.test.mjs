// createDownloader(doc, urlApi) recibe sus dependencias por parámetro —mismo patrón que
// createToaster(doc) en toast.js (toast.test.mjs:9-28) y createModal(doc, …) en modal.js
// (modal.test.mjs:11-34)— para probarlo en Node con un document/URL falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloader } from "../../app/app/js/download.js";

function fakeDoc() {
  const created = [];
  return {
    created,
    createElement(tag) {
      const el = { tag, href: "", download: "", clicks: 0, click() { this.clicks += 1; } };
      created.push(el);
      return el;
    },
  };
}

function fakeUrlApi() {
  return {
    objectUrls: [],
    revoked: [],
    createObjectURL(blob) {
      const url = "blob:fake/" + this.objectUrls.length;
      this.objectUrls.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) {
      this.revoked.push(url);
    },
  };
}

test("createDownloader: crea un <a>, le fija download con el nombre pedido, hace click UNA vez y revoca el object URL", () => {
  const doc = fakeDoc();
  const urlApi = fakeUrlApi();
  const download = createDownloader(doc, urlApi);
  const blob = { fake: "blob" };

  download(blob, "basecero-informe-2026-09-01.pdf");

  assert.equal(doc.created.length, 1);
  const a = doc.created[0];
  assert.equal(a.tag, "a");
  assert.equal(a.download, "basecero-informe-2026-09-01.pdf");
  assert.equal(a.clicks, 1);
  assert.equal(urlApi.objectUrls.length, 1);
  assert.equal(urlApi.objectUrls[0].blob, blob);
  assert.equal(a.href, urlApi.objectUrls[0].url);
  assert.deepEqual(urlApi.revoked, [urlApi.objectUrls[0].url]);
});

test("createDownloader: dos descargas seguidas crean dos <a> y revocan cada una la suya", () => {
  const doc = fakeDoc();
  const urlApi = fakeUrlApi();
  const download = createDownloader(doc, urlApi);

  download({ n: 1 }, "uno.pdf");
  download({ n: 2 }, "dos.xlsx");

  assert.equal(doc.created.length, 2);
  assert.equal(doc.created[0].download, "uno.pdf");
  assert.equal(doc.created[1].download, "dos.xlsx");
  assert.equal(urlApi.revoked.length, 2);
});
