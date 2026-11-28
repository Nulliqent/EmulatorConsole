import { describe, expect, it } from "vitest";
import type { OperationInfo, Protocol } from "../../shared/models.js";
import { maskRequest, maskResponse, matchSegments, parseUriTemplate, type MaskContext } from "./mask.js";

const S = "smithy.api#sensitive";
const NS = "test#";
const sh = (id: string) => NS + id;
const str = { type: "string" };
const secretStr = { type: "string", traits: { [S]: {} } };
const struct = (members: Record<string, { target: string; traits?: Record<string, unknown> }>, traits?: Record<string, unknown>) => ({ type: "structure", members, traits });

function ctx(protocol: Protocol, shapes: Record<string, unknown>, op: Partial<OperationInfo> = {}): MaskContext {
  return {
    shapes: { "smithy.api#String": str, ...shapes } as MaskContext["shapes"],
    protocol,
    commonErrors: [],
    op: { name: "Op", shapeId: sh("Op"), input: sh("In"), output: sh("Out"), errors: [], readonly: false, idempotent: false, paginated: false, implementation: "implemented", sensitive: { input: [], output: [] }, ...op },
  };
}
const plain = { target: "smithy.api#String" };
const req = (over: object = {}) => ({ path: "/", query: [] as [string, string][], headers: [] as [string, string][], bodyComplete: true, pathPrefix: [], ...over });

describe("JSON bodies", () => {
  const c = ctx("awsJson1_0", {
    [sh("In")]: struct({ Name: plain, Password: { target: sh("Pw") }, Nested: { target: sh("Rec") }, Tags: { target: sh("TagMap") }, Items: { target: sh("List") } }),
    [sh("Pw")]: secretStr,
    // recursive: Rec -> children[] -> Rec; Secret on every level
    [sh("Rec")]: struct({ Secret: { target: "smithy.api#String", traits: { [S]: {} } }, children: { target: sh("RecList") } }),
    [sh("RecList")]: { type: "list", member: { target: sh("Rec") } },
    // map with sensitive keys
    [sh("TagMap")]: { type: "map", key: { target: sh("Pw") }, value: plain },
    [sh("List")]: { type: "list", member: { target: sh("Pw") } },
  });

  it("hides sensitive members, in recursive shapes, map keys and list elements, and leaves everything else exactly as sent", () => {
    const body = `{ "Name": "n", "Password": "p4ss", "Nested": {"Secret":"s1","children":[{"Secret":"s2","children":[{"Secret":"s3"}]}]}, "Tags": {"k1":"v","k2":"w"}, "Items":["a","b"], "Big": 12345678901234567890 }`;
    const r = maskRequest(c, req({ body }));
    expect(r.body).toBe(
      `{ "Name": "n", "Password": "Hidden", "Nested": {"Secret":"Hidden","children":[{"Secret":"Hidden","children":[{"Secret":"Hidden"}]}]}, "Tags": {"Hidden":"v","Hidden 2":"w"}, "Items":["Hidden","Hidden"], "Big": 12345678901234567890 }`,
    );
    expect(r.hidden).toBe(1 + 3 + 2 + 2);
  });

  it("withholds a body it can't read when the operation has sensitive members, and a body cut at the limit", () => {
    expect(maskRequest(c, req({ body: "{not json" })).body).toBeNull();
    expect(maskRequest(c, req({ body: '{"Password":"p', bodyComplete: false })).body).toBeNull();
  });

  it("keeps an unreadable body when nothing in the operation is sensitive", () => {
    const plainCtx = ctx("awsJson1_0", { [sh("In")]: struct({ Name: plain }) });
    expect(maskRequest(plainCtx, req({ body: "{not json" })).body).toBe("{not json");
  });

  it("matches jsonName for restJson1 only", () => {
    const shapes = { [sh("In")]: struct({ Token: { target: sh("Pw"), traits: { "smithy.api#jsonName": "token_value" } } }), [sh("Pw")]: secretStr };
    expect(maskRequest(ctx("restJson1", shapes), req({ body: '{"token_value":"x"}' })).body).toBe('{"token_value":"Hidden"}');
    expect(maskRequest(ctx("restJson1", shapes), req({ body: '{"Token":"x"}' })).body).toBe('{"Token":"Hidden"}');
  });

  it("hides a whole body when the input structure is itself sensitive", () => {
    const whole = ctx("awsJson1_1", { [sh("In")]: struct({ A: plain }, { [S]: {} }) });
    expect(maskRequest(whole, req({ body: '{"A":"x"}' })).body).toBe("Hidden");
  });

  it("hides sensitive members of the declared error, found by __type or x-amzn-errortype, and of every error when the code is unknown", () => {
    const shapes = {
      [sh("In")]: struct({}),
      [sh("Out")]: struct({}),
      [sh("Boom")]: struct({ message: plain, Detail: { target: sh("Pw") } }, { "smithy.api#error": "client" }),
      [sh("Pw")]: secretStr,
    };
    const c2 = ctx("restJson1", shapes, { errors: [sh("Boom")] });
    const byType = maskResponse(c2, { status: 400, headers: [], body: '{"__type":"test#Boom","message":"m","Detail":"d"}', bodyComplete: true });
    expect(byType.body).toBe('{"__type":"test#Boom","message":"m","Detail":"Hidden"}');
    const byHeader = maskResponse(c2, { status: 400, headers: [["x-amzn-ErrorType", "Boom:http://x"]], body: '{"Detail":"d"}', bodyComplete: true });
    expect(byHeader.body).toBe('{"Detail":"Hidden"}');
    const unknown = maskResponse(c2, { status: 500, headers: [], body: '{"Detail":"d"}', bodyComplete: true });
    expect(unknown.body).toBe('{"Detail":"Hidden"}');
  });
});

describe("HTTP bindings", () => {
  const shapes = {
    [sh("In")]: struct({
      Bucket: { target: "smithy.api#String", traits: { "smithy.api#httpLabel": {} } },
      Key: { target: sh("Pw"), traits: { "smithy.api#httpLabel": {} } },
      Auth: { target: sh("Pw"), traits: { "smithy.api#httpHeader": "x-secret" } },
      Meta: { target: sh("Pw"), traits: { "smithy.api#httpPrefixHeaders": "x-meta-" } },
      Q: { target: sh("Pw"), traits: { "smithy.api#httpQuery": "q" } },
      Open: { target: "smithy.api#String", traits: { "smithy.api#httpQuery": "open" } },
    }),
    [sh("Pw")]: secretStr,
  };
  const c = ctx("restJson1", shapes, { http: { method: "GET", uri: "/{Bucket}/{Key+}" } });

  it("hides sensitive members bound to the header, query string and URL path", () => {
    const r = maskRequest(c, req({ path: "/bk/dir/file.txt", query: [["q", "1"], ["open", "2"]], headers: [["X-Secret", "s"], ["x-meta-a", "m"], ["x-other", "o"]] }));
    expect(r.path).toBe("/bk/Hidden/Hidden");
    expect(r.query).toEqual([["q", "Hidden"], ["open", "2"]]);
    expect(r.headers).toEqual([["X-Secret", "Hidden"], ["x-meta-a", "Hidden"], ["x-other", "o"]]);
    expect(r.hidden).toBe(4);
  });

  it("hides a bucket taken from the Host, not the path, only through the path", () => {
    const r = maskRequest(c, req({ path: "/dir/file.txt", pathPrefix: ["bk"] }));
    expect(r.path).toBe("/Hidden/Hidden");
  });

  it("hides response headers and an httpPayload that is sensitive", () => {
    const out = ctx("restJson1", {
      [sh("Out")]: struct({ Tok: { target: sh("Pw"), traits: { "smithy.api#httpHeader": "x-token" } }, Body: { target: sh("Pw"), traits: { "smithy.api#httpPayload": {} } } }),
      [sh("Pw")]: secretStr,
    });
    const r = maskResponse(out, { status: 200, headers: [["X-Token", "t"], ["x-ok", "1"]], body: "secret bytes", bodyComplete: true });
    expect(r.headers).toEqual([["X-Token", "Hidden"], ["x-ok", "1"]]);
    expect(r.body).toBe("Hidden");
  });

  it("parses and matches URI templates", () => {
    const t = parseUriTemplate("/{Bucket}/{Key+}?x-id=GetObject");
    expect(t.query).toEqual([["x-id", "GetObject"]]);
    expect(matchSegments(t.segments, ["b", "a", "c"])).toEqual(new Map([["Bucket", [0, 1]], ["Key", [1, 3]]]));
    expect(matchSegments(t.segments, ["b"])).toBeNull();
  });
});

describe("restXml", () => {
  const shapes = {
    [sh("In")]: struct({ Name: plain, Pw: { target: sh("Secret"), traits: { "smithy.api#xmlName": "Pass" } }, Rules: { target: sh("Rules"), traits: { "smithy.api#xmlFlattened": {} } }, Wrapped: { target: sh("Rules") } }),
    [sh("Secret")]: secretStr,
    [sh("Rules")]: { type: "list", member: { target: sh("Rule") } },
    [sh("Rule")]: struct({ Key: { target: sh("Secret"), traits: { "smithy.api#xmlAttribute": {} } }, Value: { target: sh("Secret") }, Plain: plain }),
  };
  const c = ctx("restXml", shapes);
  it("hides by xmlName, in flattened and wrapped lists, in attributes, and keeps the rest byte for byte", () => {
    const xml = `<?xml version="1.0"?>\n<Cfg xmlns="x">\n  <Name>n</Name><Pass>p</Pass>\n  <Rules Key="k1"><Value>v1</Value><Plain>ok</Plain></Rules><Rules Key="k2"><Value>v2</Value></Rules>\n  <Wrapped><member Key="k3"><Value>v3</Value></member></Wrapped>\n</Cfg>`;
    const r = maskRequest(c, req({ body: xml }));
    expect(r.body).toBe(
      `<?xml version="1.0"?>\n<Cfg xmlns="x">\n  <Name>n</Name><Pass>Hidden</Pass>\n  <Rules Key="Hidden"><Value>Hidden</Value><Plain>ok</Plain></Rules><Rules Key="Hidden"><Value>Hidden</Value></Rules>\n  <Wrapped><member Key="Hidden"><Value>Hidden</Value></member></Wrapped>\n</Cfg>`,
    );
  });

  it("hides sensitive members of an <Error> body", () => {
    const e = ctx("restXml", { [sh("In")]: struct({}), [sh("Out")]: struct({}), [sh("Bad")]: struct({ Detail: { target: sh("Secret") } }), [sh("Secret")]: secretStr }, { errors: [sh("Bad")] });
    const r = maskResponse(e, { status: 400, headers: [], body: "<Error><Code>Bad</Code><Detail>d</Detail></Error>", bodyComplete: true });
    expect(r.body).toBe("<Error><Code>Bad</Code><Detail>Hidden</Detail></Error>");
  });
});

describe("awsQuery and ec2Query", () => {
  const qshapes = {
    [sh("In")]: struct({
      UserName: plain,
      Password: { target: sh("Secret") },
      Attrs: { target: sh("Attrs") },
      Flat: { target: sh("Attrs"), traits: { "smithy.api#xmlFlattened": {} } },
      Items: { target: sh("Items") },
    }),
    [sh("Secret")]: secretStr,
    [sh("Attrs")]: { type: "map", key: { target: sh("Secret") }, value: { target: sh("Secret") } },
    [sh("Items")]: { type: "list", member: { target: sh("Item") } },
    [sh("Item")]: struct({ Token: { target: sh("Secret") }, Name: plain }),
  };
  it("hides form parameters by flattened key, in the body, and leaves the others as they were encoded", () => {
    const c = ctx("awsQuery", qshapes);
    const body = "Action=Op&Version=2010-05-08&UserName=a%20b&Password=pw&Attrs.entry.1.key=k&Attrs.entry.1.value=v&Flat.1.value=x&Items.member.1.Token=t&Items.member.1.Name=n";
    const r = maskRequest(c, req({ body }));
    expect(r.body).toBe("Action=Op&Version=2010-05-08&UserName=a%20b&Password=Hidden&Attrs.entry.1.key=Hidden&Attrs.entry.1.value=Hidden&Flat.1.value=Hidden&Items.member.1.Token=Hidden&Items.member.1.Name=n");
  });

  it("hides ec2Query parameters, which are flattened and named by ec2QueryName or the capitalised xmlName", () => {
    const c = ctx("ec2Query", {
      [sh("In")]: struct({ items: { target: sh("Items"), traits: { "smithy.api#xmlName": "Item" } }, password: { target: sh("Secret"), traits: { "aws.protocols#ec2QueryName": "PwdData" } } }),
      [sh("Secret")]: secretStr,
      [sh("Items")]: { type: "list", member: { target: sh("Item") } },
      [sh("Item")]: struct({ Token: { target: sh("Secret") } }),
    });
    const r = maskRequest(c, req({ body: "Action=Op&PwdData=p&Item.1.Token=t&Item.2.Token=u" }));
    expect(r.body).toBe("Action=Op&PwdData=Hidden&Item.1.Token=Hidden&Item.2.Token=Hidden");
  });

  it("hides sensitive values of awsQuery results and errors", () => {
    const c = ctx(
      "awsQuery",
      {
        [sh("In")]: struct({}),
        [sh("Out")]: struct({ Secret: { target: sh("Secret") }, Name: plain }),
        [sh("Bad")]: struct({ Detail: { target: sh("Secret") } }, { "aws.protocols#awsQueryError": { code: "BadCode", httpResponseCode: 400 } }),
        [sh("Secret")]: secretStr,
      },
      { errors: [sh("Bad")] },
    );
    const ok = maskResponse(c, { status: 200, headers: [], body: "<OpResponse><OpResult><Secret>s</Secret><Name>n</Name></OpResult></OpResponse>", bodyComplete: true });
    expect(ok.body).toBe("<OpResponse><OpResult><Secret>Hidden</Secret><Name>n</Name></OpResult></OpResponse>");
    const bad = maskResponse(c, { status: 400, headers: [], body: "<ErrorResponse><Error><Code>BadCode</Code><Detail>d</Detail></Error></ErrorResponse>", bodyComplete: true });
    expect(bad.body).toBe("<ErrorResponse><Error><Code>BadCode</Code><Detail>Hidden</Detail></Error></ErrorResponse>");
  });
});
