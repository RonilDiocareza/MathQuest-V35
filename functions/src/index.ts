import { createHash, randomUUID } from "node:crypto";

import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  onDocumentDeleted,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import {
  CallableRequest,
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();

const db = getFirestore();

const maximumLevel = 60;

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }

  return uid;
}

function normalizeLrn(value: unknown): string {
  const lrn = typeof value === "string" ? value.trim() : "";

  if (!/^\d{12}$/.test(lrn)) {
    throw new HttpsError(
      "invalid-argument",
      "LRN must contain exactly 12 digits.",
    );
  }

  return lrn;
}

function lrnIndexId(lrn: string): string {
  return createHash("sha256").update(lrn).digest("hex");
}

async function requireCurrentSession(
  request: CallableRequest<unknown>,
): Promise<string> {
  const uid = requireUid(request);

  const session = await db
    .collection("activeSessions")
    .doc(uid)
    .get();

  if (!session.exists) {
    throw new HttpsError(
      "permission-denied",
      "This device session is no longer active.",
    );
  }

  return uid;
}

export const registerStudent = onCall(async (request) => {
  const uid = requireUid(request);

  const authUser = await getAuth().getUser(uid);

  const lrn = normalizeLrn(request.data?.lrn);

  const name =
    typeof request.data?.name === "string"
      ? request.data.name.trim()
      : "";

  const address =
    typeof request.data?.address === "string"
      ? request.data.address.trim()
      : "";

  const character =
    request.data?.character === "girl"
      ? "girl"
      : "boy";

  const email =
    authUser.email?.trim().toLowerCase();

  if (!email || !name || !address) {
    throw new HttpsError(
      "invalid-argument",
      "Name, address, and email are required.",
    );
  }

  const userRef = db
    .collection("users")
    .doc(uid);

  const lrnRef = db
    .collection("lrnIndexes")
    .doc(lrnIndexId(lrn));
  const legacyLrnRef = db
    .collection("lrnIndexes")
    .doc(lrn);

  await db.runTransaction(async (transaction) => {
    const [userSnapshot, lrnSnapshot, legacyLrnSnapshot] =
      await Promise.all([
        transaction.get(userRef),
        transaction.get(lrnRef),
        transaction.get(legacyLrnRef),
      ]);

    if (userSnapshot.exists) {
      const existing = userSnapshot.data();

      if (
        existing?.email === email &&
        existing?.lrn === lrn &&
        existing?.role === "student"
      ) {
        return;
      }

      throw new HttpsError(
        "already-exists",
        "This account is already registered.",
      );
    }

    if (
      lrnSnapshot.exists &&
      lrnSnapshot.data()?.uid !== uid
    ) {
      throw new HttpsError(
        "already-exists",
        "This LRN is already registered.",
      );
    }

    if (
      legacyLrnSnapshot.exists &&
      legacyLrnSnapshot.data()?.uid !== uid
    ) {
      throw new HttpsError(
        "already-exists",
        "This LRN is already registered.",
      );
    }

    const legacyMatches = await transaction.get(
      db
        .collection("users")
        .where("lrn", "==", lrn)
        .limit(1),
    );

    if (
      legacyMatches.docs.some(
        (document) => document.id !== uid,
      )
    ) {
      throw new HttpsError(
        "already-exists",
        "This LRN is already registered.",
      );
    }

    transaction.set(lrnRef, {
      uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.create(userRef, {
      uid,
      email,
      role: "student",
      status: "pending",
      name,
      address,
      lrn,
      character,
      profilePhotoUrl: "",
      tutorialEligible: true,
      tutorialCompleted: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    registered: true,
  };
});

export const completeFirstTimeTutorial = onCall(async (request) => {
  const uid = await requireCurrentSession(request);
  const userRef = db.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  const user = userSnapshot.data();

  if (!userSnapshot.exists || user?.tutorialEligible !== true) {
    throw new HttpsError(
      "failed-precondition",
      "This account is not eligible for the first-time tutorial.",
    );
  }

  if (user.tutorialCompleted !== true) {
    await userRef.update({
      tutorialCompleted: true,
    });
  }

  return { completed: true };
});

export const getTeacherAnalytics = onCall(async (request) => {
  let stage = "verify teacher session and role";
  try {
    const uid = await requireCurrentSession(request);
    const teacherSnapshot = await db.collection("users").doc(uid).get();
    const teacher = teacherSnapshot.data();

    if (
      !teacherSnapshot.exists ||
      teacher?.role !== "teacher" ||
      teacher.status !== "approved"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only approved teacher accounts can view student analytics.",
      );
    }

    stage = "query student profiles";
    const studentsSnapshot = await db
      .collection("users")
      .where("role", "==", "student")
      .select(
        "name",
        "status",
        "gameScore",
        "scoreBaseline",
        "scoreEarned",
        "progress",
      )
      .get();
    stage = "parse student progress";
    const students = studentsSnapshot.docs.map((studentSnapshot) => {
      const student = studentSnapshot.data();

    const rawProgress = student.progress;
    const hasProgressRecord =
      rawProgress !== null &&
      typeof rawProgress === "object" &&
      !Array.isArray(rawProgress) &&
      Object.keys(rawProgress).length > 0;
    const progress = hasProgressRecord
      ? (rawProgress as Record<string, unknown>)
        : {};
    const legacyScore =
      typeof student.scoreBaseline === "number" &&
      Number.isSafeInteger(student.scoreBaseline) &&
      student.scoreBaseline >= 0 &&
      typeof student.scoreEarned === "number" &&
      Number.isSafeInteger(student.scoreEarned) &&
      student.scoreEarned >= 0
        ? student.scoreBaseline + student.scoreEarned
        : null;
    const completedLevels = Array.isArray(progress.completedLevels)
      ? [
          ...new Set(
            progress.completedLevels.filter(
              (level): level is number =>
                typeof level === "number" &&
                Number.isInteger(level) &&
                level >= 1 &&
                level <= maximumLevel,
            ),
          ),
        ].sort((first, second) => first - second)
      : [];
    const gameModeScores: Record<string, number> = {};
    const rawGameModeScores = progress.gameModeFinalScores;
    if (
      rawGameModeScores !== null &&
      typeof rawGameModeScores === "object" &&
      !Array.isArray(rawGameModeScores)
    ) {
      for (const [level, score] of Object.entries(rawGameModeScores)) {
        const levelNumber = Number(level);
        if (
          Number.isInteger(levelNumber) &&
          levelNumber >= 1 &&
          levelNumber <= maximumLevel &&
          typeof score === "number" &&
          Number.isInteger(score) &&
          score >= 0 &&
          score <= 70
        ) {
          gameModeScores[level] = score;
        }
      }
    }

    const rawQuestResults = progress.classroomQuestResults;
    const questResults =
      rawQuestResults !== null &&
      typeof rawQuestResults === "object" &&
      !Array.isArray(rawQuestResults)
        ? (rawQuestResults as Record<string, unknown>)
        : {};
    const rawQuest = questResults.classroom_quest;
    const quest =
      rawQuest !== null &&
      typeof rawQuest === "object" &&
      !Array.isArray(rawQuest)
        ? (rawQuest as Record<string, unknown>)
        : null;
    const rawCompletionTimes = progress.classroomQuestCompletionTimes;
    const completionTimes =
      rawCompletionTimes !== null &&
      typeof rawCompletionTimes === "object" &&
      !Array.isArray(rawCompletionTimes)
        ? (rawCompletionTimes as Record<string, unknown>)
        : {};
    const completionTime = completionTimes.classroom_quest;
    const savedCompletionTime =
      typeof completionTime === "number" &&
      Number.isSafeInteger(completionTime) &&
      completionTime >= 0
        ? completionTime
        : null;

    const legacyNpcQuestions = Array.isArray(progress.completedNpcQuestions)
      ? progress.completedNpcQuestions.filter(
          (question): question is number =>
            typeof question === "number" &&
            Number.isInteger(question) &&
            question >= 1 &&
            question <= 6,
        )
      : [];
    const rawNpcByLevel = progress.completedNpcQuestionsByLevel;
    const npcByLevel =
      rawNpcByLevel !== null &&
      typeof rawNpcByLevel === "object" &&
      !Array.isArray(rawNpcByLevel)
        ? (rawNpcByLevel as Record<string, unknown>)
        : {};
    const completedNpcQuestionCount = Object.entries(npcByLevel).reduce(
      (count, [level, questions]) => {
        if (level === "1" || !Array.isArray(questions)) {
          return count;
        }
        return (
          count +
          new Set(
            questions.filter(
              (question): question is number =>
                typeof question === "number" &&
                Number.isInteger(question) &&
                question >= 1 &&
                question <= 6,
            ),
          ).size
        );
      },
      Object.prototype.hasOwnProperty.call(npcByLevel, "1")
        ? 0
        : new Set(legacyNpcQuestions).size,
    );
    const savedScore =
      typeof student.gameScore === "number" &&
      Number.isSafeInteger(student.gameScore) &&
      student.gameScore >= 0
        ? student.gameScore
        : legacyScore;

      return {
        uid: studentSnapshot.id,
        name:
          typeof student.name === "string" && student.name.trim()
            ? student.name.trim()
            : "Student",
        status: typeof student.status === "string" ? student.status : "unknown",
        hasProgressRecord,
        gameScore: savedScore,
        completedLevels,
        questAttempts:
          typeof progress.questAttempts === "number" &&
          Number.isSafeInteger(progress.questAttempts) &&
          progress.questAttempts >= 0
            ? progress.questAttempts
            : 0,
        classroomQuest:
          quest === null && savedCompletionTime === null
            ? null
            : {
                score:
                  typeof quest?.score === "number" &&
                  Number.isSafeInteger(quest.score) &&
                  quest.score >= 0
                    ? quest.score
                    : null,
                correctAnswers:
                  typeof quest?.correctAnswers === "number" &&
                  Number.isSafeInteger(quest.correctAnswers) &&
                  quest.correctAnswers >= 0
                    ? quest.correctAnswers
                    : null,
                totalQuestions:
                  typeof quest?.totalQuestions === "number" &&
                  Number.isSafeInteger(quest.totalQuestions) &&
                  quest.totalQuestions >= 0
                    ? quest.totalQuestions
                    : null,
                completionTimeSeconds:
                  typeof quest?.completionTimeSeconds === "number" &&
                  Number.isSafeInteger(quest.completionTimeSeconds) &&
                  quest.completionTimeSeconds >= 0
                    ? quest.completionTimeSeconds
                    : savedCompletionTime,
              },
        gameModeFinalScores: gameModeScores,
        completedNpcQuestionCount,
      };
    });
    students.sort((first, second) => first.name.localeCompare(second.name));

    logger.info("Teacher analytics loaded.", {
      studentCount: students.length,
      studentsWithProgress: students.filter((student) =>
        student.hasProgressRecord
      ).length,
    });
    return { students };
  } catch (error) {
    const errorCode =
      error instanceof HttpsError
        ? error.code
        : typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
          ? error.code
          : "unexpected";
    logger.error("Teacher analytics request failed.", {
      stage,
      code: errorCode,
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      `Unable to load teacher analytics while attempting to ${stage}.`,
    );
  }
});

export const claimLoginSession = onCall(async (request) => {
  let stage = "validating login";

  try {
    const uid = requireUid(request);

    const deviceId = request.data?.deviceId;

    if (
      typeof deviceId !== "string" ||
      deviceId.length < 16 ||
      deviceId.length > 128
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A valid device identifier is required.",
      );
    }

    stage = "checking the account profile";

    const user = await db
      .collection("users")
      .doc(uid)
      .get();

    const userData = user.data();

    if (
      !user.exists ||
      userData?.status !== "approved"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This account is not approved.",
      );
    }

    if (
      userData.role === "student" &&
      typeof userData.lrn === "string" &&
      /^\d{12}$/.test(userData.lrn.trim())
    ) {
      stage = "checking the account LRN";

      const duplicateLrns = await db
        .collection("users")
        .where("lrn", "==", userData.lrn.trim())
        .limit(2)
        .get();

      if (duplicateLrns.size > 1) {
        throw new HttpsError(
          "failed-precondition",
          "This LRN is assigned to multiple accounts. Ask an administrator to resolve the duplicate records.",
        );
      }
    }

    const sessionId = randomUUID();

    const sessionRef = db
      .collection("activeSessions")
      .doc(uid);

    const now = Date.now();

    stage = "claiming the device session";

    await db.runTransaction(async (transaction) => {
      const existing =
        await transaction.get(sessionRef);

      const data = existing.data();

      const expiry =
        data?.expiresAt instanceof Timestamp
          ? data.expiresAt.toMillis()
          : 0;

      const existingSessionIsActive =
        existing.exists &&
        (
          data?.persistent === true ||
          expiry > now
        );

      if (
        existingSessionIsActive &&
        data?.deviceId !== deviceId
      ) {
        throw new HttpsError(
          "permission-denied",
          "This account is already active on another device. Sign out there first.",
        );
      }

      transaction.set(sessionRef, {
        deviceId,
        sessionId,
        persistent: true,
        claimedAt: FieldValue.serverTimestamp(),
      });
    });

    stage =
      "updating Firebase Authentication session claims";

    const authUser =
      await getAuth().getUser(uid);

    try {
      await getAuth().setCustomUserClaims(uid, {
        ...authUser.customClaims,
        mathQuestSessionId: sessionId,
      });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const current =
          await transaction.get(sessionRef);

        if (
          current.data()?.sessionId === sessionId
        ) {
          transaction.delete(sessionRef);
        }
      });

      throw error;
    }

    return {
      sessionId,
    };
  } catch (error) {
    logger.error(
      "Unable to establish a device login session.",
      {
        stage,
        code:
          error instanceof HttpsError
            ? error.code
            : "unexpected",
      },
    );

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      `Unable to establish device session while ${stage}.`,
    );
  }
});

export const heartbeatLoginSession = onCall(
  async (request) => {
    const uid = requireUid(request);

    const sessionId =
      request.data?.sessionId;

    const deviceId =
      request.data?.deviceId;

    if (
      typeof sessionId !== "string" ||
      typeof deviceId !== "string"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A valid device session is required.",
      );
    }

    if (
      request.auth?.token.mathQuestSessionId !==
      sessionId
    ) {
      throw new HttpsError(
        "permission-denied",
        "This device session is no longer active.",
      );
    }

    const sessionRef = db
      .collection("activeSessions")
      .doc(uid);

    await db.runTransaction(async (transaction) => {
      const session =
        await transaction.get(sessionRef);

      if (
        !session.exists ||
        session.data()?.sessionId !== sessionId ||
        session.data()?.deviceId !== deviceId
      ) {
        throw new HttpsError(
          "permission-denied",
          "This device session is no longer active.",
        );
      }

      transaction.update(sessionRef, {
        lastSeenAt:
          FieldValue.serverTimestamp(),
      });
    });

    return {
      active: true,
    };
  },
);

export const releaseLoginSession = onCall(
  async (request) => {
    const uid = requireUid(request);

    const sessionId =
      request.data?.sessionId;

    const deviceId =
      request.data?.deviceId;

    if (
      typeof sessionId !== "string" ||
      typeof deviceId !== "string"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A valid device session is required.",
      );
    }

    const sessionRef = db
      .collection("activeSessions")
      .doc(uid);

    const released =
      await db.runTransaction(async (transaction) => {
        const session =
          await transaction.get(sessionRef);

        if (
          !session.exists ||
          session.data()?.sessionId !== sessionId ||
          session.data()?.deviceId !== deviceId
        ) {
          return false;
        }

        transaction.delete(sessionRef);

        return true;
      });

    if (released) {
      const authUser =
        await getAuth().getUser(uid);

      const claims = {
        ...authUser.customClaims,
      };

      if (
        claims.mathQuestSessionId ===
        sessionId
      ) {
        delete claims.mathQuestSessionId;

        await getAuth().setCustomUserClaims(
          uid,
          claims,
        );
      }
    }

    return {
      released,
    };
  },
);

export const clearLoginSession = onCall(
  async (request) => {
    const adminUid =
      await requireCurrentSession(request);

    const admin =
      await db
        .collection("users")
        .doc(adminUid)
        .get();

    if (admin.data()?.role !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only admins can clear a login session.",
      );
    }

    const targetUid =
      request.data?.targetUid;

    if (
      typeof targetUid !== "string" ||
      targetUid.length === 0
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A valid account UID is required.",
      );
    }

    if (targetUid === adminUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot clear your own active session.",
      );
    }

    await db
      .collection("activeSessions")
      .doc(targetUid)
      .delete();

    try {
      const targetUser =
        await getAuth().getUser(targetUid);

      const claims = {
        ...targetUser.customClaims,
      };

      delete claims.mathQuestSessionId;

      await getAuth().setCustomUserClaims(
        targetUid,
        claims,
      );
    } catch (error) {
      if (
        !(
          error instanceof Error
        ) ||
        !("code" in error) ||
        error.code !== "auth/user-not-found"
      ) {
        throw error;
      }
    }

    return {
      cleared: true,
    };
  },
);

export const approveExistingAccountAsTeacher = onCall(
  async (request) => {
    let stage = "verifying the admin session";
    try {
      const adminUid = await requireCurrentSession(request);

      stage = "validating the target account UID";
      const targetUid = request.data?.targetUid;
      if (
        typeof targetUid !== "string" ||
        targetUid.trim().length === 0 ||
        targetUid.includes("/")
      ) {
        throw new HttpsError(
          "invalid-argument",
          "A valid account UID is required.",
        );
      }

      if (targetUid === adminUid) {
        throw new HttpsError(
          "failed-precondition",
          "An admin account cannot be converted to a teacher account.",
        );
      }

      stage = "verifying the target Firebase Authentication account";
      try {
        await getAuth().getUser(targetUid);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "auth/user-not-found"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "The selected account has no matching Firebase Authentication user.",
          );
        }
        throw error;
      }

      const adminRef = db.collection("users").doc(adminUid);
      const targetRef = db.collection("users").doc(targetUid);
      stage = "reading admin and target Firestore profiles";
      const result = await db.runTransaction(async (transaction) => {
        const adminSnapshot = await transaction.get(adminRef);
        const targetSnapshot = await transaction.get(targetRef);

        if (adminSnapshot.data()?.role !== "admin") {
          throw new HttpsError(
            "permission-denied",
            "Only admins can approve teacher accounts.",
          );
        }
        if (!targetSnapshot.exists) {
          throw new HttpsError(
            "not-found",
            "The selected account was not found.",
          );
        }

        const target = targetSnapshot.data();
        if (target?.role === "teacher" && target.status === "approved") {
          return { approved: true, alreadyApproved: true };
        }

        if (
          target?.role !== "student" ||
          (target.status !== "pending" && target.status !== "approved")
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Only an existing student account can be approved as a teacher.",
          );
        }

        transaction.update(targetRef, {
          role: "teacher",
          status: "approved",
        });
        return { approved: true, alreadyApproved: false };
      });

      return result;
    } catch (error) {
      if (error instanceof HttpsError) throw error;

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Teacher account approval failed.", {
        stage,
        errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "unknown",
      });
      throw new HttpsError(
        "internal",
        `Teacher approval failed while ${stage}: ${errorMessage}`,
      );
    }
  },
);

export const cleanupDeletedUser =
  onDocumentDeleted(
    "users/{uid}",
    async (event) => {
      const uid = event.params.uid;

      const userData =
        event.data?.data();

      const sessionRef =
        db
          .collection("activeSessions")
          .doc(uid);

      const batch = db.batch();

      batch.delete(sessionRef);

      const rawLrn =
        userData?.lrn;

      if (
        typeof rawLrn === "string" &&
        /^\d{12}$/.test(rawLrn.trim())
      ) {
        const normalizedLrn = rawLrn.trim();
        const lrnCollection = db.collection("lrnIndexes");
        const lrnRefs = [
          lrnCollection.doc(lrnIndexId(normalizedLrn)),
          lrnCollection.doc(normalizedLrn),
        ];
        const lrnSnapshots = await Promise.all(
          lrnRefs.map((reference) => reference.get()),
        );

        for (const [index, snapshot] of lrnSnapshots.entries()) {
          if (snapshot.data()?.uid === uid) {
            batch.delete(lrnRefs[index]);
          }
        }
      }

      await batch.commit();

      try {
        await getAuth().deleteUser(uid);
      } catch (error) {
        if (
          !(
            error instanceof Error
          ) ||
          !("code" in error) ||
          error.code !== "auth/user-not-found"
        ) {
          throw error;
        }
      }
    },
  );

type ProgressScoreAward = {
  id: string;
  points: number;
};

function progressScoreAwards(
  userData: FirebaseFirestore.DocumentData | undefined,
): Map<string, ProgressScoreAward> {
  const progress = userData?.progress;
  const awards = new Map<string, ProgressScoreAward>();
  const questionsByLevel =
    progress?.completedNpcQuestionsByLevel;

  if (
    questionsByLevel &&
    typeof questionsByLevel === "object" &&
    !Array.isArray(questionsByLevel)
  ) {
    for (const [rawLevel, rawQuestions] of Object.entries(
      questionsByLevel as Record<string, unknown>,
    )) {
      const level = Number(rawLevel);
      if (
        !Number.isInteger(level) ||
        level < 1 ||
        level > maximumLevel ||
        !Array.isArray(rawQuestions)
      ) {
        continue;
      }

      for (const rawQuestion of rawQuestions) {
        const question = Number(rawQuestion);
        if (
          !Number.isInteger(question) ||
          question < 1 ||
          question > 6
        ) {
          continue;
        }

        const id = `npc-${level}-${question}`;
        awards.set(id, { id, points: 10 });
      }
    }
  }

  const legacyQuestions =
    progress?.completedNpcQuestions;
  const hasLevelOneQuestions =
    questionsByLevel &&
    typeof questionsByLevel === "object" &&
    Object.prototype.hasOwnProperty.call(questionsByLevel, "1");

  if (!hasLevelOneQuestions && Array.isArray(legacyQuestions)) {
    for (const rawQuestion of legacyQuestions) {
      const question = Number(rawQuestion);
      if (
        Number.isInteger(question) &&
        question >= 1 &&
        question <= 6
      ) {
        const id = `npc-1-${question}`;
        awards.set(id, { id, points: 10 });
      }
    }
  }

  const completedLevels = new Set<unknown>([
    ...(Array.isArray(progress?.completedLevels)
      ? progress.completedLevels
      : []),
    ...(Array.isArray(progress?.completedGameLevels)
      ? progress.completedGameLevels
      : []),
  ]);
  for (const rawLevel of completedLevels) {
    const level = Number(rawLevel);
    if (
      Number.isInteger(level) &&
      level >= 1 &&
      level <= maximumLevel
    ) {
      const id = `game-level-${level}`;
      awards.set(id, { id, points: 10 });
    }
  }

  return awards;
}

async function reconcileProgressScoreAwards(uid: string): Promise<void> {
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) return;

    const awards = [
      ...progressScoreAwards(userSnapshot.data()).values(),
    ];
    if (awards.length === 0) return;
    const awardRefs = awards.map((award) =>
      userRef.collection("scoreAwards").doc(award.id),
    );
    const awardSnapshots = await Promise.all(
      awardRefs.map((awardRef) => transaction.get(awardRef)),
    );
    const unrecordedAwards = awards.filter(
      (_, index) => !awardSnapshots[index].exists,
    );
    if (unrecordedAwards.length === 0) return;

    const userData = userSnapshot.data()!;
    const baseline = userData.scoreBaseline ?? 0;
    const earned = userData.scoreEarned ?? 0;
    if (
      !Number.isSafeInteger(baseline) ||
      baseline < 0 ||
      !Number.isSafeInteger(earned) ||
      earned < 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "The saved score data is invalid.",
      );
    }

    const newEarned =
      earned +
      unrecordedAwards.reduce(
        (total, award) => total + award.points,
        0,
      );
    const gameScore = baseline + newEarned;
    if (!Number.isSafeInteger(gameScore)) {
      throw new HttpsError(
        "out-of-range",
        "The saved score is outside the supported range.",
      );
    }

    for (const award of unrecordedAwards) {
      transaction.create(
        userRef.collection("scoreAwards").doc(award.id),
        {
          points: award.points,
          createdAt: FieldValue.serverTimestamp(),
        },
      );
    }
    transaction.update(userRef, {
      scoreEarned: newEarned,
      gameScore,
    });
  });
}

async function updateLeaderboard(
  uid: string,
  userData: FirebaseFirestore.DocumentData,
) {
  const leaderboardRef =
    db
      .collection("leaderboard")
      .doc(uid);

  if (
    userData.role !== "student" ||
    userData.status !== "approved"
  ) {
    await leaderboardRef.delete();
    return;
  }

  const displayName =
    typeof userData.name === "string" &&
    userData.name.trim()
      ? userData.name
          .trim()
          .slice(0, 80)
      : "Player";

  const totalScore = userData.gameScore ?? 0;
  if (
    !Number.isSafeInteger(totalScore) ||
    totalScore < 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      `The saved score for ${uid} is invalid.`,
    );
  }

  await leaderboardRef.set({
    uid,
    displayName,
    totalScore,
    updatedAt:
      FieldValue.serverTimestamp(),
  });
}

export const syncLeaderboardFromUser =
  onDocumentWritten(
    {
      document: "users/{uid}",
      retry: true,
    },
    async (event) => {
      const uid = event.params.uid;

      const after =
        event.data?.after;

      if (!after?.exists) {
        await db
          .collection("leaderboard")
          .doc(uid)
          .delete();

        return;
      }

      const userData =
        after.data();

      if (!userData) {
        await db
          .collection("leaderboard")
          .doc(uid)
          .delete();

        return;
      }

      await reconcileProgressScoreAwards(uid);

      const latestUser =
        await db.collection("users").doc(uid).get();
      if (!latestUser.exists) {
        await db.collection("leaderboard").doc(uid).delete();
        return;
      }

      await updateLeaderboard(uid, latestUser.data()!);
    },
  );

export const syncMyLeaderboard =
  onCall(async (request) => {
    const uid =
      await requireCurrentSession(
        request,
      );

    const userSnapshot =
      await db
        .collection("users")
        .doc(uid)
        .get();

    if (!userSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Your user profile could not be found.",
      );
    }

    const userData =
      userSnapshot.data()!;

    if (
      userData.role !== "student" ||
      userData.status !== "approved"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Only approved student accounts can use the leaderboard.",
      );
    }

    await reconcileProgressScoreAwards(uid);
    const latestUserSnapshot = await db
      .collection("users")
      .doc(uid)
      .get();
    if (!latestUserSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Your user profile could not be found.",
      );
    }
    const latestUserData = latestUserSnapshot.data()!;
    await updateLeaderboard(
      uid,
      latestUserData,
    );

    const score = latestUserData.gameScore ?? 0;

    return {
      uid,
      totalScore: score,
    };
  });

export const backfillLeaderboard =
  onCall({ timeoutSeconds: 540 }, async (request) => {
    const uid =
      await requireCurrentSession(
        request,
      );

    const adminSnapshot =
      await db
        .collection("users")
        .doc(uid)
        .get();

    if (
      adminSnapshot.data()?.role !==
      "admin"
    ) {
      throw new HttpsError(
        "permission-denied",
        "Only admins can backfill the leaderboard.",
      );
    }

    const rawScores = request.data?.scores;
    if (!Array.isArray(rawScores)) {
      throw new HttpsError(
        "invalid-argument",
        "Provide the authoritative score export as a scores array.",
      );
    }

    const importedScores = new Map<string, number>();
    for (const row of rawScores) {
      const rowUid =
        row && typeof row === "object" && "uid" in row
          ? row.uid
          : undefined;
      const rawScore =
        row && typeof row === "object" && "totalScore" in row
          ? row.totalScore
          : undefined;
      if (
        typeof rowUid !== "string" ||
        rowUid.length === 0 ||
        rowUid.includes("/") ||
        !Number.isSafeInteger(rawScore) ||
        (rawScore as number) < 0 ||
        importedScores.has(rowUid)
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Each score row must contain a unique UID and a non-negative integer totalScore.",
        );
      }
      importedScores.set(rowUid, rawScore as number);
    }

    const users =
      db.collection("users");

    let cursor:
      FirebaseFirestore.QueryDocumentSnapshot
      | undefined;

    const allUsers: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    while (true) {
      let query =
        users
          .orderBy(
            FieldPath.documentId(),
          )
          .limit(400);

      if (cursor) {
        query =
          query.startAfter(cursor);
      }

      const page =
        await query.get();

      if (page.empty) {
        break;
      }

      allUsers.push(...page.docs);

      if (page.size < 400) {
        break;
      }

      cursor =
        page.docs[
          page.docs.length - 1
        ];
    }

    const approvedStudents = allUsers.filter((user) => {
      const data = user.data();
      return data.role === "student" && data.status === "approved";
    });
    const approvedIds = new Set(
      approvedStudents.map((user) => user.id),
    );
    const unknownUids = [...importedScores.keys()].filter(
      (studentUid) => !approvedIds.has(studentUid),
    );
    if (unknownUids.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `The score export contains UIDs that are not approved students: ${unknownUids.slice(0, 5).join(", ")}.`,
      );
    }

    const missingUids = approvedStudents
      .filter((user) => {
        const userData = user.data();
        return (
          userData.scoreBaseline === undefined &&
          !importedScores.has(user.id)
        );
      })
      .map((user) => user.id);
    if (missingUids.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `No saved baseline score was found for these approved students: ${missingUids.slice(0, 5).join(", ")}.`,
      );
    }

    let processed = 0;
    for (const user of approvedStudents) {
      const userRef = users.doc(user.id);
      const leaderboardRef =
        db.collection("leaderboard").doc(user.id);

      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(userRef);
        if (!latest.exists) return;

        const userData = latest.data()!;
        if (
          userData.role !== "student" ||
          userData.status !== "approved"
        ) {
          return;
        }

        const baseline =
          userData.scoreBaseline ??
          importedScores.get(user.id);
        const earned = userData.scoreEarned ?? 0;
        if (
          !Number.isSafeInteger(baseline) ||
          (baseline as number) < 0 ||
          !Number.isSafeInteger(earned) ||
          earned < 0 ||
          !Number.isSafeInteger((baseline as number) + earned)
        ) {
          throw new HttpsError(
            "failed-precondition",
            `The score export or saved score for ${user.id} is invalid.`,
          );
        }

        const displayName =
          typeof userData.name === "string" &&
          userData.name.trim()
            ? userData.name.trim().slice(0, 80)
            : "Player";
        const totalScore = (baseline as number) + earned;

        transaction.set(
          userRef,
          {
            scoreBaseline: baseline,
            scoreEarned: earned,
            gameScore: totalScore,
          },
          { merge: true },
        );
        transaction.set(leaderboardRef, {
          uid: user.id,
          displayName,
          totalScore,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      processed += 1;
    }

    return {
      processed,
    };
  });