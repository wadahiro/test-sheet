class LoginTest {
    @Test
    @DisplayName("LOGIN-002 a session is issued after login")
    fun sessionIsIssuedAfterLogin() {
        val session = client.login("demo-user", "Passw0rd!")
        assertThat(session.token).isNotBlank()
    }

    @Test
    fun unrelated() {
        assertThat(1).isEqualTo(1)
    }
}
