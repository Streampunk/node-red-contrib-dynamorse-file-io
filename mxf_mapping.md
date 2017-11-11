I'm in the process of implementing a mapping from MXF files to streams of grains. The following ramblings are my first attempt at documenting the process. The aim is that media in an MXF file or stream can be translated into flows of grains and vice versa, with as much if the identity and timing information from the MXF file preserved by the process. The benefit is that we can start to blur the distinction between live streams and stored content, with the same grains appearing in streams from different sources having the same flow ID, source ID and timestamps.

The development environment is as follows:
Pure Javascript Node.JS library kelvinadon (https://github.com/Streampunk/kelvinadon) used to read and write MXF data as a stream of Javascript/JSON objects.
Through dynamorse MXF-In and MXF-Out nodes, part of the fil-io package (https://github.com/Streampunk/node-red-contrib-dynamorse-file-io) with some V1.0 NMOS support.

The main focus of the work is OP1a files that stored frame-interleaved video and audio but - with further work - this approach should extend to elementary stream files such as those used in AS-02, IMF and OP-Atom.

Timing

Essence elements within an MXF file are stored in time order with a specified edit rate. Index tables can be used to determine an essence element sequence index to byte offset mapping. With knowledge of the edit rate, time offsets from the start of the file to byte offsets can be calculated. The file also contains a number of mandatory Zulu-based UTC timestamps, including file last modified, package created and package modified values. A package may contain a number of tracks and each track is a candidate to become an elementary flow with each grain representing an edit unit of frame-wrapped essence element of the MXF file, or an edit-unit's-worth of data from a clip-wrapped-essence.

PTP origin timestamps for a grain can be created by taking the package created timestamp of the lowest level source package of a file as a base, which is typically the single material package representing the synchronized playable output. Where just a Each grain duration for a track is derived from the track's edit rate. The grain's PTP origin timestamp is the sum of:
the product of the edit unit count and the grain duration;
the base creation time of the source package.
In theory, this model allows content from the same source that has been transcoded to different formats to appear with the same origin timestamp.

PTP sync timestamps for a grain can be created in a similar way, but this time from the creation time timestamp of the primary package in the file as a base point. The timestamp should be adjusted by the origin property of a given MXF track in its top-level file package, allowing for synchronisation offsets e.g. sound tracks starting slightly earlier than video tracks.

Where a timecode track is provided, timecode values should be copied into the grains they label. Where a timcode track is provided, the base time for a PTP timestamp may be the date taken from the creation time combined with the timecode label converted to a time since midnight PTP value.

Where no primary package is specified, the first material package in the MXF file should be used.

Identity & grouping

The management of identity across different styles of MXF file can vary. Packages have a unique material identifier (UMID) but as a package may contain several tracks, so a direct one-to-one mapping from the the package identifier to the flow and source identifier is not possible. Moreover, the definition of source in NMOS as of a specific essence type may have to be twisted a bit to get to source package in MXF as a representation of more than one essence type. However, a simple mapping that leads to a consistent reproduction of identifiers from copies of the same file or versions of the same material can be considered.

A material package is effectively equivalent to the logical cables introduced into dynamorse. Therefore, the logical cable should be given an identifier equivalent to the material package identifier - a UUID with the same value as the last 16 bytes of the material package's UMID binary representation. (Richard frantically adds ID to logical cables!)

Flow ID and Source ID can be generated as V5 name-based UUIDs (see https://tools.ietf.org/html/rfc4122) by taking the package UUIDs as the namespace and combining it with its track identifier property:
Source IDs should be generated from the lowest level source package. In this way, content with the same original source package, even if from a different file, gets the same source identifier.
Flow IDs should be generated from the material package identifier, so that two flows from the same file end up with same flow identifier.
As an example:
The UUID of a source package is '4ec362ae-5774-05c7-0800-460202998cb7' and the track ID of the picture essence track is 'TrackID2'. Use the bytes of the UUID as the namespace to feed the start of the sha1 digest and a UTF-8 string representation of the track shown as the remaining bytes. The resulting source identifier is: '967e6946-b8a0-5b36-ba8c-f6f0ea3f1091'.
This track is referenced from a source clip in a primary package and the material package has identifier '4dc362ae-5774-05c7-0800-460202998cb7' - also used as the logical cable identifier, with 'TrackID4'. The resulting flow identifier is 'a6be3833-3916-5be0-ba46-2acc89725d0b'.
