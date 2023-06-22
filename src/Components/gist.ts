// Shape of file content from user input (i.e. examples.json, data structure
// passed to App.runApp). If the type is "binary", then content is a
import { isBinary, stringToUint8Array, uint8ArrayToString } from "../utils";
import { FileContent } from "./filecontent";
import { clone } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';

import { Buffer } from 'buffer'
globalThis.Buffer = Buffer;

export type GistApiResponse = {
  url: string;
  id: string;
  files: {
    [filename: string]: GistFile;
  };
  public: boolean;
  created_at: string;
  updated_at: string;
  description: string;
  comments: 1;
};

export type GistCheckoutResponse = {
  fs: LightningFS;
  id: string;
  files: string[];
}

type GistFile = {
  filename: string;
  type: string;
  language: string;
  raw_url: string;
  size: number;
  truncated: boolean;
  // content is base64-encoded, even for text files, because we make the
  // request with Accept: "application/vnd.github.v3.base64".
  content: string;
};

const db = undefined as unknown as LightningFS.IDB;
const fs = new LightningFS('fs', { wipe: true, db });
const pfs = fs.promises;

export async function checkoutGist(id: string): Promise<GistCheckoutResponse> {
  await pfs.mkdir(`/${id}`, { mode: 777 });
  await clone({
    fs,
    http,
    dir: `/${id}`,
    url: `https://gist.github.com/${id}.git`,
    corsProxy: 'https://cors.isomorphic-git.org'
  });
  const files = await pfs.readdir(`/${id}`);
  return { fs, id, files};
}

export async function gistCheckoutResponseToFileContents(
  gist: GistCheckoutResponse
): Promise<FileContent[]> {
  const result: FileContent[] = [];

  for (const filename of gist.files) {
    if (filename === '.git') continue;
    const content = await pfs.readFile(`/${gist.id}/${filename}`) as Uint8Array;
    const binary = isBinary(content);
    if (binary) {
      result.push({
        name: filename,
        type: "binary",
        content,
      });
    } else {
      result.push({
        name: filename,
        type: "text",
        content: uint8ArrayToString(content),
      });
    }
  }
  return result;
}

export async function fetchGist(id: string): Promise<GistApiResponse> {
  const response = await fetch("https://api.github.com/gists/" + id, {
    headers: {
      Accept: "application/vnd.github.v3.base64",
    },
  });
  const gistData = (await response.json()) as GistApiResponse;
  return gistData;
}

export async function gistApiResponseToFileContents(
  gist: GistApiResponse
): Promise<FileContent[]> {
  const result: FileContent[] = [];

  for (const filename in gist.files) {
    const gistFile = gist.files[filename];

    let binary: boolean;
    let contentString: string = "";
    let contentArray: Uint8Array = new Uint8Array(0);

    // Some Gist file entries are truncated. The API docs say it happens
    // when the files are over a megabyte. For these files, we need to fetch
    // the file directly, and we'll put the content in place.
    // https://docs.github.com/en/rest/gists/gists#truncation
    if (gistFile.truncated) {
      const reponse = await fetch(gistFile.raw_url);
      const contentBlob = await reponse.blob();
      contentArray = new Uint8Array(await contentBlob.arrayBuffer());
      // The gist API includes the 'type' field, but they are not always
      // helpful. 'type' can be "text/plain" for some binary files like sqlite
      // .db files.
      binary = isBinary(contentArray);
      if (binary) {
        contentString = uint8ArrayToString(contentArray);
      }
    } else {
      contentString = window.atob(gistFile.content);
      binary = isBinary(contentString);
      if (binary) {
        contentArray = stringToUint8Array(contentString);
      }
    }

    if (binary) {
      result.push({
        name: gistFile.filename,
        type: "binary",
        content: contentArray,
      });
    } else {
      result.push({
        name: gistFile.filename,
        type: "text",
        content: contentString,
      });
    }
  }

  return result;
}
