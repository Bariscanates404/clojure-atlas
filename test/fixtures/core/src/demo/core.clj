(ns demo.core
  (:require [demo.util :as u :refer [helper]]))

(defprotocol Shape (area [s]))
(defrecord Square [x] Shape (area [_] (u/twice x)))

(def table {:a 1})

(defn f [m & more]
  (let [x (helper (:a m))]
    (map helper [x])
    (f m)
    (count more)))

(defmacro m [x] `(let [y# ~x] (if y# (f y#) table)))

(defn- secret [] (->Square 2))
