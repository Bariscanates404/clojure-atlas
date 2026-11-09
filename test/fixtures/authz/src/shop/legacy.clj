(ns shop.legacy
  (:require [shop.web :refer [GET*]]
            [shop.handlers :as h]))

(def legacy (GET* "/legacy" [] (h/health nil)))
