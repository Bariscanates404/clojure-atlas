export interface Selector {
    kind: 'class' | 'testid';
    value: string;
}
export interface PageObjectMember {
    name: string;
    line: number;
    endLine: number;
    selectors: Selector[];
    uses: string[];
}
export interface PageObject {
    name: string;
    file: string;
    line: number;
    base?: string;
    members: PageObjectMember[];
}
export interface TestRef {
    member: string;
    line: number;
    matcher?: string;
}
export interface BrowserTest {
    file: string;
    line: number;
    endLine: number;
    title: string;
    describe: string[];
    refs: TestRef[];
}
export interface PlaywrightProject {
    dir: string;
    typescript: string;
    pageObjects: PageObject[];
    tests: BrowserTest[];
}
export interface Playwright {
    projects: PlaywrightProject[];
    skipped: string[];
}
type Ts = any;
export declare function selectorsIn(css: string): Selector[];
export declare function readPlaywright(root: string, packageJsons: readonly string[], typescript: readonly string[], load?: (pkg: string) => Ts): Playwright;
export {};
