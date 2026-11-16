(ns shop.permissions)

(def route->permission
  "The permission each export route requires."
  {"/orders.csv" :export-orders
   "/audit.log" #{:export-audit :auditor}})

(def by-key {:invoice :read-invoices})
