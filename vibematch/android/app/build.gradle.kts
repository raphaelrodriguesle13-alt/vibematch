import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun String.toBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val releaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}

android {
    namespace = "com.vibematch.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vibematch.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            val debugApiBaseUrl = providers.gradleProperty("API_BASE_URL")
                .orElse(providers.environmentVariable("API_BASE_URL"))
                .orElse("http://10.0.2.2:3000")
                .get()
            val debugGoogleClientId = providers.gradleProperty("GOOGLE_SERVER_CLIENT_ID")
                .orElse(providers.environmentVariable("GOOGLE_SERVER_CLIENT_ID"))
                .orElse("")
                .get()
            val debugFacebookAppId = providers.gradleProperty("FACEBOOK_APP_ID")
                .orElse(providers.environmentVariable("FACEBOOK_APP_ID"))
                .orElse("")
                .get()
            val debugFacebookClientToken = providers.gradleProperty("FACEBOOK_CLIENT_TOKEN")
                .orElse(providers.environmentVariable("FACEBOOK_CLIENT_TOKEN"))
                .orElse("")
                .get()
            val debugLiveKitUrl = providers.gradleProperty("LIVEKIT_URL")
                .orElse(providers.environmentVariable("LIVEKIT_URL"))
                .orElse("")
                .get()
            val debugBillingProductId = providers.gradleProperty("BILLING_PRODUCT_ID")
                .orElse(providers.environmentVariable("BILLING_PRODUCT_ID"))
                .orElse("")
                .get()
            val debugBillingValidationPath = providers.gradleProperty("BILLING_VALIDATION_PATH")
                .orElse("/api/billing/verify-purchase")
                .get()
            buildConfigField("String", "API_BASE_URL", debugApiBaseUrl.toBuildConfigString())
            buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", debugGoogleClientId.toBuildConfigString())
            buildConfigField("String", "FACEBOOK_APP_ID", debugFacebookAppId.toBuildConfigString())
            buildConfigField("String", "FACEBOOK_CLIENT_TOKEN", debugFacebookClientToken.toBuildConfigString())
            buildConfigField("String", "LIVEKIT_URL", debugLiveKitUrl.toBuildConfigString())
            buildConfigField("String", "BILLING_PRODUCT_ID", debugBillingProductId.toBuildConfigString())
            buildConfigField("String", "BILLING_VALIDATION_PATH", debugBillingValidationPath.toBuildConfigString())
        }
        release {
            val releaseApiBaseUrl = providers.gradleProperty("API_BASE_URL")
                .orElse(providers.environmentVariable("API_BASE_URL"))
                .orElse("https://api.vibematch.example")
                .get()
            val releaseGoogleClientId = providers.gradleProperty("GOOGLE_SERVER_CLIENT_ID")
                .orElse(providers.environmentVariable("GOOGLE_SERVER_CLIENT_ID"))
                .orElse("MISSING_GOOGLE_SERVER_CLIENT_ID")
                .get()
            val releaseFacebookAppId = providers.gradleProperty("FACEBOOK_APP_ID")
                .orElse(providers.environmentVariable("FACEBOOK_APP_ID"))
                .orElse("MISSING_FACEBOOK_APP_ID")
                .get()
            val releaseFacebookClientToken = providers.gradleProperty("FACEBOOK_CLIENT_TOKEN")
                .orElse(providers.environmentVariable("FACEBOOK_CLIENT_TOKEN"))
                .orElse("MISSING_FACEBOOK_CLIENT_TOKEN")
                .get()
            val releaseLiveKitUrl = providers.gradleProperty("LIVEKIT_URL")
                .orElse(providers.environmentVariable("LIVEKIT_URL"))
                .orElse("MISSING_LIVEKIT_URL")
                .get()
            val releaseBillingProductId = providers.gradleProperty("BILLING_PRODUCT_ID")
                .orElse(providers.environmentVariable("BILLING_PRODUCT_ID"))
                .orElse("MISSING_BILLING_PRODUCT_ID")
                .get()
            val releaseBillingValidationPath = providers.gradleProperty("BILLING_VALIDATION_PATH")
                .orElse("/api/billing/verify-purchase")
                .get()
            if (releaseBuildRequested) {
                val releaseApiHost = runCatching { URI(releaseApiBaseUrl).host?.lowercase() }
                    .getOrNull()
                val releaseLiveKitHost = runCatching { URI(releaseLiveKitUrl).host?.lowercase() }
                    .getOrNull()
                val localHosts = setOf("localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2")
                require(releaseApiBaseUrl.startsWith("https://")) {
                    "Release API_BASE_URL must use HTTPS"
                }
                require(releaseApiHost != null && releaseApiHost !in localHosts) {
                    "Release API_BASE_URL must not use a local host"
                }
                require(
                    releaseGoogleClientId.endsWith(".apps.googleusercontent.com") &&
                        !releaseGoogleClientId.startsWith("MISSING_")
                ) {
                    "Release GOOGLE_SERVER_CLIENT_ID must be a Google Web OAuth client ID"
                }
                require(
                    releaseFacebookAppId.isNotBlank() &&
                        !releaseFacebookAppId.startsWith("MISSING_")
                ) {
                    "Release FACEBOOK_APP_ID must be configured"
                }
                require(
                    releaseFacebookClientToken.isNotBlank() &&
                        !releaseFacebookClientToken.startsWith("MISSING_")
                ) {
                    "Release FACEBOOK_CLIENT_TOKEN must be configured"
                }
                require(releaseLiveKitUrl.startsWith("wss://")) {
                    "Release LIVEKIT_URL must use wss://"
                }
                require(releaseLiveKitHost != null && releaseLiveKitHost !in localHosts) {
                    "Release LIVEKIT_URL must not use a local host"
                }
                require(releaseBillingProductId != "MISSING_BILLING_PRODUCT_ID") {
                    "Release BILLING_PRODUCT_ID must be configured"
                }
            }
            if (releaseBuildRequested) {
                require(releaseBillingValidationPath.startsWith("/")) {
                    "Release BILLING_VALIDATION_PATH must be an absolute API path"
                }
            }
            buildConfigField("String", "API_BASE_URL", releaseApiBaseUrl.toBuildConfigString())
            buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", releaseGoogleClientId.toBuildConfigString())
            buildConfigField("String", "FACEBOOK_APP_ID", releaseFacebookAppId.toBuildConfigString())
            buildConfigField("String", "FACEBOOK_CLIENT_TOKEN", releaseFacebookClientToken.toBuildConfigString())
            buildConfigField("String", "LIVEKIT_URL", releaseLiveKitUrl.toBuildConfigString())
            buildConfigField("String", "BILLING_PRODUCT_ID", releaseBillingProductId.toBuildConfigString())
            buildConfigField("String", "BILLING_VALIDATION_PATH", releaseBillingValidationPath.toBuildConfigString())
            isDebuggable = false
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
    implementation("com.facebook.android:facebook-login:18.3.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.livekit:livekit-android:2.28.1")
    implementation("com.android.billingclient:billing:9.1.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
