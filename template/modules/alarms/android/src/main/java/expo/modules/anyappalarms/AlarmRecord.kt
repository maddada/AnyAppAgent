package expo.modules.anyappalarms

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** The alarm object passed from JavaScript (see modules/alarms/index.ts). */
class AlarmRecord : Record {
  @Field val id: String = ""
  @Field val at: Double = 0.0
  @Field val title: String = ""
  @Field val body: String? = null
  @Field val speak: String? = null
  @Field val language: String? = null
  @Field val sound: String? = null
  @Field val repeat: String? = null
}
