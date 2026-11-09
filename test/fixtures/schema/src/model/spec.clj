(ns model.spec
  (:require [clojure.spec.alpha :as s]))

(defn email? [x] (string? x))

(s/def ::email email?)
(s/def ::person (s/keys :req [::email]))

(defn valid-person? [p] (s/valid? ::person p))

(defn just-data [] {::email "not a spec use"})
