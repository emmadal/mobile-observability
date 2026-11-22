package expo.modules.mobileobservability

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager

/** Device and network conditions attached to time-to-interactive events. */
class DeviceState(private val context: Context) {
  fun snapshot(): Map<String, Any> {
    val result = mutableMapOf<String, Any>()
    val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
    if (power != null) {
      result["lowPowerMode"] = power.isPowerSaveMode
      result["thermalState"] =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) thermalState(power.currentThermalStatus) else "unknown"
    }
    batteryInfo(result)
    networkInfo(result)
    return result
  }

  private fun thermalState(status: Int): String = when (status) {
    PowerManager.THERMAL_STATUS_NONE -> "nominal"
    PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> "fair"
    PowerManager.THERMAL_STATUS_SEVERE -> "serious"
    PowerManager.THERMAL_STATUS_CRITICAL, PowerManager.THERMAL_STATUS_EMERGENCY,
    PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
    else -> "unknown"
  }

  private fun batteryInfo(result: MutableMap<String, Any>) {
    val intent: Intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level >= 0 && scale > 0) result["batteryLevel"] = level.toDouble() / scale
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    if (status != -1) {
      result["batteryCharging"] =
        status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    }
  }

  private fun networkInfo(result: MutableMap<String, Any>) {
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val capabilities = try {
      connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
    } catch (_: SecurityException) {
      null
    }
    if (capabilities == null) {
      result["networkConnected"] = false
      result["networkType"] = if (connectivity == null) "unknown" else "none"
      return
    }
    result["networkConnected"] = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    result["networkType"] = when {
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
      else -> "other"
    }
    result["networkExpensive"] = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    result["dataSaverEnabled"] =
      connectivity?.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
  }
}
