(ns shop.routes-test
  (:require [clojure.test :refer [deftest is]]
            [reitit.ring :as ring]
            [shop.handlers :as h]))

(deftest a-test-router-serves-nothing
  (is (ring/router [["/only-in-tests" {:get h/health}]])))
