// The one answer to "is this file test code?", shared by the graph builder and the queries: a file under a
// test/ or tests/ directory, or named *_test / *_tests with a Clojure extension.
export const isTestFile = (f) => !!f && /(^|\/)tests?\/|_tests?\.clj[sc]?$/.test(f);
