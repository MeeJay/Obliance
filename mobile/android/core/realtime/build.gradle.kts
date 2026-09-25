import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Real-time client of the platform (design doc §10.6): Socket.IO over the
// shared OkHttp 5 stack, session cookie in the handshake. Pure JVM.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":core:common"))
    api(libs.kotlinx.coroutines.core)
    api(libs.okhttp)
    // socket.io-client declares OkHttp 3.12: force the one OkHttp of the app.
    implementation(libs.socketio.client) {
        exclude(group = "com.squareup.okhttp3")
    }
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

// The proof test starts a real Socket.IO 4 server with Node; it is skipped
// when Node or the repository's node_modules are missing.
tasks.withType<Test>().configureEach {
    systemProperty("obli.repo.root", rootProject.projectDir.resolve("../..").canonicalPath)
}
