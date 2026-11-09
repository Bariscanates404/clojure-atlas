(ns shop.catalog
  (:require [reitit.ring]
            [shop.handlers :as h]))

(def ^:private reader :read-catalog)

(def ^:private editor-authz {:permission :edit-catalog})

(defn- item-authz [permission] {:permission permission :tenant :item})

(defn catalog-routes []
  (into ["/catalog" {:authz {:permission reader}}]
        [["/items" {:get {:handler h/report :authz (item-authz :read-items)}
                    :put {:handler h/report :authz editor-authz}}]
         ["/export" {:post {:handler h/report
                            :authz [{:permission :export} {:permission :read-items :or {:permission :admin}}]}}]
         ["/browse" {:get h/report}]]))
