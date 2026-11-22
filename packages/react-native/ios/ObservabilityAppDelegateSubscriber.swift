import ExpoModulesCore
import UIKit

/// Starts native collection from `didFinishLaunching`, before the JS bundle runs.
public class ObservabilityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    ObservabilityRuntime.start()
    return false
  }
}
