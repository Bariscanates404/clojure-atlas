(ns shop.web
  (:require [compojure.core :as c]))

(defmacro GET* [path & body] `(c/GET ~path ~@body))
