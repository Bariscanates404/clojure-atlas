(ns demo.shared
  (:require [demo.util :as u]))

(defn both [x] (u/helper x))

#?(:clj (defn jvm-only [] (both 1))
   :cljs (defn js-only [] (both 2)))
