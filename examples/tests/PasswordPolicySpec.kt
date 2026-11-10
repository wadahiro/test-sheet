class PasswordPolicySpec : FunSpec({
    context("rejected passwords") {
        withData(
            Rejected("PWPOLICY-REJECT-01", "Ab1"),
            Rejected("PWPOLICY-REJECT-02", "Password"),
            Rejected("PWPOLICY-REJECT-03", "demo-user"),
        ) { case ->
            account.changePassword(case.password).shouldBeFailure()
            account.login("demo-user", "Passw0rd!").shouldBeSuccess()
        }
    }
})
