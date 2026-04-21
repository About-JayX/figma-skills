async function executeJob(command) {
  try {
    const commandType = command && command.__commandType ? command.__commandType : 'extract-node-defs';
    if (commandType === 'extract-image-asset') {
      await handleExtractImageAsset(command);
    } else {
      await handleExtractNodeDefs(command);
    }
  } catch (error) {
    const normalizedError = normalizePluginError(error);
    const jobId = command && command.jobId ? command.jobId : null;
    const target = command && command.target ? command.target : {};
    const lastStatus = command && command.__jobStatusState ? command.__jobStatusState : null;

    if (lastStatus && !normalizedError.details) {
      normalizedError.details = {};
    }
    if (lastStatus && normalizedError.details && !normalizedError.details.lastStatus) {
      normalizedError.details.lastStatus = lastStatus;
    }

    figma.ui.postMessage({
      type: 'status',
      stage: lastStatus && lastStatus.stage ? lastStatus.stage : 'job.failed',
      text:
        'job ' +
        jobId +
        ' failed: ' +
        normalizedError.message +
        (lastStatus && lastStatus.stage ? ' | lastStage=' + lastStatus.stage : ''),
      state: 'error',
      details: normalizedError.details || null,
    });

    if (jobId) {
      try {
        await postJobResult(
          jobId,
          {
            ok: false,
            jobId: jobId,
            fileKey: target.fileKey || null,
            nodeId: target.nodeId || null,
            error: normalizedError.message,
            errorCode: normalizedError.code,
            details: normalizedError.details,
          },
          null
        );
      } catch (callbackError) {
        figma.ui.postMessage({
          type: 'status',
          text:
            'job ' +
            jobId +
            ' callback failed: ' +
            (callbackError instanceof Error ? callbackError.message : String(callbackError)),
          state: 'error',
        });
      }
    }
  }
}

function enqueueJob(command) {
  jobQueue = jobQueue.then(
    () => executeJob(command),
    () => executeJob(command)
  );
}
