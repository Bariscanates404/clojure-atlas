import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, EMPTY_CONFIG, parseConfig } from '../src/build/config.ts';
import { routeAuthz, permissionRoutes } from '../src/mcp/queries.ts';
import { graphFromJson } from '../src/mcp/graph.ts';
import { buildFixture } from './helpers/atlas-fixture.ts';

describe('.clojure-atlas.edn', () => {
  it('reads every key', () => {
    const c = parseConfig(`{:lint-as {a.b/defx clojure.core/def}
      :route-authz {:key :authz :permission :perm :exempt :public :scope :tenant :alternative :or}
      :permission-middleware [a.auth/wrap-perm] :permission-fns [a.auth/check!]
      :route-macros {a.web/GET* compojure.core/GET}}`);
    assert.deepEqual(c, {
      lintAs: { 'a.b/defx': 'clojure.core/def' },
      routeAuthz: { key: ':authz', permission: ':perm', exempt: ':public', scope: ':tenant', alternative: ':or' },
      permissionMiddleware: ['a.auth/wrap-perm'], permissionFns: ['a.auth/check!'], routeMacros: { 'a.web/GET*': 'compojure.core/GET' },
    });
  });
  it('an empty map is the empty config', () => assert.deepEqual(parseConfig('{}'), EMPTY_CONFIG));
  it('names what is wrong', () => {
    for (const [src, msg] of [
      ['{:lint-az {}}', /unknown key :lint-az/],
      ['{:route-authz {:permission :p}}', /needs :key/],
      ['{:route-authz {:key authz}}', /:key must be a keyword/],
      ['{:permission-fns [check!]}', /qualified symbols/],
      ['{:lint-as {a/b c}}', /qualified symbol/],
      ['[1]', /one map/],
      ['{:a', /line 1/],
      ['{:lint-as {a/b c/d} :lint-as {x/y z/w}}', /duplicate key :lint-as/],
      ['{:lint-as {a/b c/d, a/b e/f}}', /duplicate key a\/b/],
      ['#:foo{:lint-as {a/b c/d}}', /unknown key :foo\/lint-as/],
    ] as const) assert.throws(() => parseConfig(src), (e: unknown) => e instanceof ConfigError && msg.test((e as Error).message), src);
  });
});

describe('route authz end to end through the MCP queries', () => {
  it('route_authz and permission_routes answer from a built graph', async () => {
    const g = graphFromJson(JSON.stringify(await buildFixture('authz')));
    assert.match(routeAuthz(g, 'GET /api/reports').verdict, /requires .*perm.* AND :read-reports|requires :read-reports AND .*perm/);
    assert.match(routeAuthz(g, 'GET /api/orders').verdict, /^requires \(:read-orders OR :admin\)$/);
    assert.match(routeAuthz(g, 'DELETE /api/orders/:id').verdict, /\(:audit AND :write-orders\) AND :delete-order/);
    assert.match(routeAuthz(g, 'GET /health').verdict, /^exempt: load balancer probe$/);
    assert.match(routeAuthz(g, 'GET /admin').verdict, /NO permission check/);
    assert.match(routeAuthz(g, 'POST /catalog/export').verdict, /^requires :export AND \(:read-items OR :admin\)$/);
    assert.match(routeAuthz(g, 'GET /catalog/browse').verdict, /^requires :read-catalog$/);
    assert.match(permissionRoutes(g, ':admin').verdict, /guards 2 route copy\(ies\): 0 require it, 2 accept it as one of alternatives/);
  });
  it('without a declaration the capability is absent and an unchecked route is unknown, not unguarded', async () => {
    const g = graphFromJson(JSON.stringify(await buildFixture('routes')));
    assert.equal(g.doc.capabilities.find((c) => c.name === 'route_authz')?.status, 'absent');
    assert.match(routeAuthz(g, 'GET /health').verdict, /not provable/);
  });
});
