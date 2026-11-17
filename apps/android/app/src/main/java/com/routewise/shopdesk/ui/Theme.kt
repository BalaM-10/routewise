package com.routewise.shopdesk.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The web app's tokens: green for this device, blue for the cloud, amber for caution. */
@Immutable
data class Palette(
    val ground: Color, val surface: Color, val sunken: Color,
    val ink: Color, val ink2: Color, val ink3: Color,
    val rule: Color, val ruleStrong: Color,
    val device: Color, val deviceWash: Color,
    val cloud: Color, val cloudWash: Color,
    val signal: Color, val signalWash: Color,
)

private val Light = Palette(
    ground = Color(0xFFEEF1EF), surface = Color(0xFFFFFFFF), sunken = Color(0xFFF5F7F6),
    ink = Color(0xFF18211D), ink2 = Color(0xFF47524D), ink3 = Color(0xFF58635E),
    rule = Color(0xFFD9DFDC), ruleStrong = Color(0xFFB9C3BE),
    device = Color(0xFF0E6B58), deviceWash = Color(0xFFE3F1EC),
    cloud = Color(0xFF2D58A0), cloudWash = Color(0xFFE6EDF8),
    signal = Color(0xFFA86A12), signalWash = Color(0xFFFBF1DF),
)

private val Dark = Palette(
    ground = Color(0xFF121816), surface = Color(0xFF19211E), sunken = Color(0xFF141B18),
    ink = Color(0xFFE8EEEB), ink2 = Color(0xFFB9C4BF), ink3 = Color(0xFF8C9893),
    rule = Color(0xFF2A3531), ruleStrong = Color(0xFF3C4A45),
    device = Color(0xFF4CC2A2), deviceWash = Color(0xFF13302A),
    cloud = Color(0xFF8AAEF0), cloudWash = Color(0xFF1A2741),
    signal = Color(0xFFE3A54A), signalWash = Color(0xFF2E2414),
)

val LocalPalette = staticCompositionLocalOf { Light }

object P {
    val c: Palette @Composable get() = LocalPalette.current
}

@Composable
fun ShopdeskTheme(content: @Composable () -> Unit) {
    val p = if (isSystemInDarkTheme()) Dark else Light
    val scheme = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = p.ink, onPrimary = p.surface, background = p.ground, surface = p.surface, onSurface = p.ink, onBackground = p.ink)
    } else {
        lightColorScheme(primary = p.ink, onPrimary = p.surface, background = p.ground, surface = p.surface, onSurface = p.ink, onBackground = p.ink)
    }
    val type = Typography(
        headlineLarge = TextStyle(fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp),
        titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
        labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold),
    )
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
