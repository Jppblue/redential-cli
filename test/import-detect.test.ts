import { describe, expect, it } from "vitest";
import { extractImportedPackages } from "../src/import-detect.js";

describe("extractImportedPackages — JS/TS", () => {
  it("extracts a default import", () => {
    expect(extractImportedPackages('import Stripe from "stripe";', "a.ts")).toEqual(["stripe"]);
  });

  it("extracts a named import", () => {
    expect(extractImportedPackages('import { z } from "zod";', "a.ts")).toEqual(["zod"]);
  });

  it("extracts a multi-line named import", () => {
    const diff = 'import {\n  foo,\n  bar,\n} from "@org/pkg";\n';
    expect(extractImportedPackages(diff, "a.ts")).toEqual(["@org/pkg"]);
  });

  it("normalizes a subpath import to the top-level package", () => {
    expect(extractImportedPackages('import Webhooks from "stripe/webhooks";', "a.ts")).toEqual(["stripe"]);
  });

  it("normalizes a scoped package with a subpath to scope+package", () => {
    expect(extractImportedPackages('import x from "@radix-ui/react-dialog";', "a.ts")).toEqual([
      "@radix-ui/react-dialog",
    ]);
  });

  it("extracts a side-effect import with no `from`", () => {
    expect(extractImportedPackages('import "reflect-metadata";', "a.ts")).toEqual(["reflect-metadata"]);
  });

  it("extracts a bare export-from re-export", () => {
    expect(extractImportedPackages('export * from "some-pkg";', "a.ts")).toEqual(["some-pkg"]);
  });

  it("extracts require()", () => {
    expect(extractImportedPackages('const x = require("lodash");', "a.js")).toEqual(["lodash"]);
  });

  it("extracts dynamic import()", () => {
    expect(extractImportedPackages('const mod = await import("some-pkg");', "a.ts")).toEqual(["some-pkg"]);
  });

  it("does not match an import inside a // comment", () => {
    expect(extractImportedPackages('// import Stripe from "stripe";', "a.ts")).toEqual([]);
  });

  it("does not match a require() inside a // comment", () => {
    expect(extractImportedPackages('// const x = require("lodash");', "a.ts")).toEqual([]);
  });

  it("does not match import-shaped text embedded in a plain string literal", () => {
    expect(extractImportedPackages("const example = \"import Stripe from 'stripe';\";", "a.ts")).toEqual([]);
  });

  it("does not match require-shaped text embedded in a plain string literal", () => {
    expect(extractImportedPackages("const doc = \"call require('pkg') to load it\";", "a.ts")).toEqual([]);
  });

  it("does not match a package name mentioned inside a URL", () => {
    expect(extractImportedPackages('// see https://npmjs.com/package/stripe for docs', "a.ts")).toEqual([]);
  });

  it("never scans a markdown file, even if it contains real-looking import syntax", () => {
    expect(extractImportedPackages('import Stripe from "stripe";', "README.md")).toEqual([]);
  });

  it("returns [] for an unrecognized file extension", () => {
    expect(extractImportedPackages('import Stripe from "stripe";', "a.unknown")).toEqual([]);
  });
});

describe("extractImportedPackages — Python", () => {
  it("extracts a plain import", () => {
    expect(extractImportedPackages("import pandas", "a.py")).toEqual(["pandas"]);
  });

  it("extracts import with alias", () => {
    expect(extractImportedPackages("import pandas as pd", "a.py")).toEqual(["pandas"]);
  });

  it("extracts multiple comma-separated imports", () => {
    expect(extractImportedPackages("import os, pandas as pd, sys", "a.py")).toEqual(["os", "pandas", "sys"]);
  });

  it("extracts from-import and normalizes a submodule", () => {
    expect(extractImportedPackages("from fastapi import FastAPI", "a.py")).toEqual(["fastapi"]);
    expect(extractImportedPackages("from django.db import models", "a.py")).toEqual(["django"]);
  });

  it("does not match a # comment", () => {
    expect(extractImportedPackages("# import pandas as pd", "a.py")).toEqual([]);
  });

  it("does not match import-shaped text inside a string literal", () => {
    expect(extractImportedPackages('doc = "import pandas as pd"', "a.py")).toEqual([]);
  });
});

describe("extractImportedPackages — Go", () => {
  it("extracts a single-line import and strips a version suffix", () => {
    expect(extractImportedPackages('import "github.com/redis/go-redis/v9"', "main.go")).toEqual([
      "github.com/redis/go-redis",
    ]);
  });

  it("extracts every path inside an import block", () => {
    const diff = 'import (\n\t"fmt"\n\t"github.com/gin-gonic/gin"\n)';
    expect(extractImportedPackages(diff, "main.go")).toEqual(["fmt", "github.com/gin-gonic/gin"]);
  });

  it("does not match a // comment", () => {
    expect(extractImportedPackages('// import "fmt"', "main.go")).toEqual([]);
  });
});

describe("extractImportedPackages — Ruby", () => {
  it("extracts require and normalizes a subpath", () => {
    expect(extractImportedPackages('require "sidekiq/api"', "app.rb")).toEqual(["sidekiq"]);
  });

  it("does not extract require_relative (local file, not a package)", () => {
    expect(extractImportedPackages('require_relative "../lib/foo"', "app.rb")).toEqual([]);
  });

  it("extracts gem declarations from a Gemfile", () => {
    expect(extractImportedPackages('gem "devise"\ngem "sidekiq", "~> 7.0"', "Gemfile")).toEqual([
      "devise",
      "sidekiq",
    ]);
  });

  it("does not match a # comment", () => {
    expect(extractImportedPackages('# require "sidekiq"', "app.rb")).toEqual([]);
  });
});

describe("extractImportedPackages — PHP", () => {
  it("extracts the first namespace segment from a use statement", () => {
    expect(extractImportedPackages("use Illuminate\\Http\\Request;", "app/Foo.php")).toEqual(["illuminate"]);
  });

  it("parses composer.json's require block", () => {
    const diff = JSON.stringify({ require: { php: "^8.1", "laravel/framework": "^10.0" } });
    expect(extractImportedPackages(diff, "composer.json")).toEqual(["laravel/framework"]);
  });

  it("does not match a // comment", () => {
    expect(extractImportedPackages("// use Illuminate\\Http\\Request;", "app/Foo.php")).toEqual([]);
  });
});
