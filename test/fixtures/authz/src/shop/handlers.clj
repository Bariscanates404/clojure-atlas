(ns shop.handlers
  (:require [shop.auth :as auth]
            [shop.macros :refer [defhandler]]))

#_{:clj-kondo/ignore [:unresolved-symbol]} (defhandler list-orders [req] req)
(defn delete-order [req] (auth/require! req :delete-order) req)
(defn collect [h] h)
(defn health [_] {:status 200})
(defn report [_] {})
