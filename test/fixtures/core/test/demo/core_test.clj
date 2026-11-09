(ns demo.core-test
  (:require [clojure.test :refer [deftest is]]
            [demo.core :as c]))

(defn fixture-map [] {:a 1})

(deftest f-test
  (is (= 1 (c/f (fixture-map))))
  (is (thrown? Exception (c/f nil))))
