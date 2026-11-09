(ns app.views)

(defn login-form []
  [:form.login-form
   [:input {:class "username field"}]
   [:input {:class ["password" "field"]}]
   [:button {:data-testid "submit"} "Log in"]
   [:span.not-tested "x"]])
