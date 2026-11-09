(ns app.views)

(defn login-form []
  [:form.qa-login-form
   [:input {:class "qa-username field"}]
   [:input {:class ["qa-password" "field"]}]
   [:button {:data-testid "submit"} "Log in"]
   [:span.not-tested "x"]])
