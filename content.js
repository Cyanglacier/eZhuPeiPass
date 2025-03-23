console.log('[Content] 内容脚本开始加载');

// 添加全局错误处理器，防止错误显示到UI
window.addEventListener('error', function(event) {
  // 阻止错误冒泡
  event.preventDefault();
  event.stopPropagation();
  // 仅打印到控制台
  console.error('[Content] 捕获到错误 (已阻止显示):', event.error || event.message);
  return true; // 阻止默认处理
});

// 捕获Promise未处理的rejection
window.addEventListener('unhandledrejection', function(event) {
  // 阻止错误冒泡
  event.preventDefault();
  event.stopPropagation();
  // 仅打印到控制台
  console.error('[Content] 捕获到未处理的Promise错误 (已阻止显示):', event.reason);
  return true; // 阻止默认处理
});

// 检查background.js是否准备就绪
async function checkBackgroundReady(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`[Content] 检查background.js就绪状态 (尝试 ${i + 1}/${maxRetries})`);
      
      // 创建一个Promise包装的消息发送
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('检查background.js就绪状态超时'));
        }, 1000);
        
        try {
          chrome.runtime.sendMessage({ action: 'isReady' }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve(response);
          });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });
      
      if (response && response.ready) {
        console.log('[Content] background.js已就绪');
        return true;
      }
    } catch (error) {
      console.warn(`[Content] background.js未就绪 (尝试 ${i + 1}/${maxRetries}):`, error.message);
      // 等待一会再尝试
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.error('[Content] background.js未能在指定尝试次数内就绪');
  return false;
}

// 监听来自popup和background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理状态更新消息
  if (request.action === 'updateStatus') {
    console.log(`[Content] 收到状态更新: ${request.status}`);
    
    // 同时保存状态到本地存储，确保popup打开时可以读取最新状态
    chrome.storage.local.set({ 'currentStatus': request.status }, function() {
      console.log('[Content] 状态已保存到本地存储:', request.status);
    });
    
    // 如果是处理完成状态，多次转发确保popup能收到
    if (request.status.includes('解答完成') || request.status.includes('已显示全部答案')) {
      console.log('[Content] 收到完成状态，启动多次转发机制');
      
      // 定义转发函数
      const forwardStatus = () => {
        try {
          // 使用fire-and-forget方式发送
          chrome.runtime.sendMessage({
            action: 'updatePopupStatus',
            status: request.status,
            timestamp: Date.now() // 添加时间戳避免缓存
          });
          console.log('[Content] 完成状态已转发 (不等待响应)');
        } catch (err) {
          console.warn('[Content] 发送消息异常:', err.message);
        }
      };
      
      // 立即转发一次
      forwardStatus();
      
      // 然后延迟多次转发，提高成功率
      setTimeout(forwardStatus, 500);
      setTimeout(forwardStatus, 1200);
      setTimeout(forwardStatus, 2000);
    } else {
      // 普通状态更新正常转发
      try {
        // 使用fire-and-forget方式发送消息，不等待响应
        chrome.runtime.sendMessage({
          action: 'updatePopupStatus',
          status: request.status
        });
        console.log('[Content] 状态更新已发送到popup (不等待响应)');
      } catch (err) {
        console.warn('[Content] 发送普通状态更新异常:', err.message);
      }
    }
    
    return true;
  }
  
  // 处理进度更新消息
  if (request.action === 'updateProgress') {
    console.log(`[Content] 收到进度更新: ${request.progress}%`);
    
    // 保存进度状态到本地存储
    const progressStatus = `处理进度: ${request.progress}%`;
    chrome.storage.local.set({ 'currentStatus': progressStatus }, function() {
      console.log('[Content] 进度状态已保存到本地存储:', progressStatus);
    });
    
    try {
      // 使用fire-and-forget方式发送消息，不等待响应
      chrome.runtime.sendMessage({
        action: 'updatePopupStatus',
        status: progressStatus
      });
      console.log('[Content] 进度更新已发送到popup (不等待响应)');
    } catch (err) {
      console.warn('[Content] 发送进度更新异常:', err.message);
    }
    
    // 如果进度达到100%，自动发送完成状态
    if (request.progress === 100) {
      console.log('[Content] 进度达到100%，启动多次发送完成状态');
      
      const completionStatus = '解答完成，已显示全部答案';
      
      // 存储完成状态
      chrome.storage.local.set({ 'currentStatus': completionStatus }, function() {
        console.log('[Content] 完成状态已保存到本地存储');
      });
      
      // 定义发送100%完成函数
      const sendCompletion = () => {
        console.log('[Content] 发送完成状态 (延迟触发)');
        try {
          // 使用fire-and-forget方式发送完成状态，不等待响应
          chrome.runtime.sendMessage({
            action: 'updatePopupStatus',
            status: completionStatus,
            timestamp: Date.now() // 添加时间戳避免缓存
          });
          console.log('[Content] 完成状态已发送 (不等待响应)');
        } catch (err) {
          console.warn('[Content] 发送完成状态异常:', err.message);
        }
      };
      
      // 使用多个延迟，确保至少一个成功
      setTimeout(sendCompletion, 500);
      setTimeout(sendCompletion, 1200);
      setTimeout(sendCompletion, 2000);
    }
    
    return true;
  }
  
  // 处理获取题目消息
  if (request.action === 'getQuestions') {
    console.log('[Content] 开始处理getQuestions请求');
    const questions = detectQuestions();
    console.log('[Content] 检测到的题目:', questions.length ? `${questions.length}个题目` : '未检测到题目');
    
    if (questions.length === 0) {
      console.log('[Content] 未检测到题目，返回错误信息');
      sendResponse({
        error: '未在页面上检测到题目，请确保您正在浏览包含考试题目的页面'
      });
      return true;
    }

    // 创建一个包含回调的标志
    let callbackCalled = false;
    
    // 创建Promise来处理异步操作
    const processQuestions = new Promise((resolve, reject) => {
      chrome.storage.local.get(['apiKey'], function(result) {
        console.log('[Content] 获取API密钥状态:', result.apiKey ? '成功' : '未设置');
        
        if (!result.apiKey) {
          console.log('[Content] API密钥未设置，返回错误');
          reject(new Error('请先设置API密钥'));
          return;
        }

        // 验证API密钥格式
        if (!result.apiKey || !result.apiKey.startsWith('sk-')) {
          console.log('[Content] API密钥格式无效');
          reject(new Error('API密钥格式无效'));
          return;
        }

        // 设置一个本地超时，确保即使background脚本完全无响应也能返回错误
        let timeoutId = setTimeout(() => {
          console.error('[Content] 等待AI查询响应超时');
          if (!callbackCalled) {
            callbackCalled = true;
            reject(new Error('等待AI查询响应超时，请检查网络连接或重试'));
          }
        }, 240000); // 4分钟超时，要比background的总体超时长

        // 直接处理题目，避免background.js通信问题
        const handleQuestions = async (retryCount = 0) => {
          try {
            console.log(`[Content] 开始调用background script进行AI查询 (尝试 ${retryCount + 1}/3):`, questions.length, '个题目');
            
            // 添加一个延时，确保background.js已准备好接收消息
            if (retryCount > 0) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 首先检查background.js是否就绪
            const isReady = await checkBackgroundReady();
            if (!isReady && retryCount < 2) {
              console.log(`[Content] background.js未就绪，稍后重试 (${retryCount + 1}/3)`);
              setTimeout(() => handleQuestions(retryCount + 1), 1500);
              return;
            }
            
            chrome.runtime.sendMessage({
              action: 'queryAI',
              questions: questions,
              apiKey: result.apiKey
            }, function(response) {
              // 确保我们只处理一次回调
              if (callbackCalled) {
                console.log('[Content] 忽略重复的响应');
                return;
              }
              
              if (chrome.runtime.lastError) {
                console.error('[Content] background脚本响应错误:', chrome.runtime.lastError);
                
                // 如果还有重试次数，则尝试重新发送
                if (retryCount < 2) {
                  console.log(`[Content] 尝试重新连接background脚本 (${retryCount + 1}/3)`);
                  setTimeout(() => handleQuestions(retryCount + 1), 1000);
                  return;
                }
                
                callbackCalled = true;
                clearTimeout(timeoutId);
                reject(new Error(`通信错误: ${chrome.runtime.lastError.message || '无法连接到扩展后台'}, 请重新加载扩展或刷新页面后重试`));
                return;
              }
              
              callbackCalled = true;
              clearTimeout(timeoutId);
              
              if (!response) {
                console.error('[Content] 未收到AI查询响应');
                reject(new Error('未收到AI查询响应，请检查网络连接'));
                return;
              }
              
              console.log('[Content] 收到AI查询响应:', response.success ? '成功' : '失败', response.error || '');
              
              if (response.success) {
                console.log('[Content] AI查询成功，显示答案');
                if (!response.answers || !Array.isArray(response.answers) || response.answers.length === 0) {
                  console.error('[Content] 响应中没有有效的答案');
                  
                  // 向popup发送特殊错误消息
                  chrome.runtime.sendMessage({
                    action: 'updatePopupStatus',
                    status: 'AI未返回有效答案，请重试'
                  });
                  
                  reject(new Error('AI返回的响应中没有有效的答案'));
                  return;
                }
                
                // 不再严格要求答案数量与题目数量匹配
                if (response.answers.length < questions.length) {
                  console.warn('[Content] 警告：答案数量少于题目数量:', {
                    answersCount: response.answers.length,
                    questionsCount: questions.length
                  });
                  // 尝试补充缺失的答案
                  while (response.answers.length < questions.length) {
                    response.answers.push("未知");
                  }
                } else if (response.answers.length > questions.length) {
                  console.warn('[Content] 警告：答案数量多于题目数量，将截断:', {
                    answersCount: response.answers.length,
                    questionsCount: questions.length
                  });
                  // 截断多余的答案
                  response.answers = response.answers.slice(0, questions.length);
                }
                
                displayAnswers(questions, response.answers);
                resolve({success: true, questions: questions});
              } else {
                console.error('[Content] AI查询失败:', response.error);
                reject(new Error(response.error || '查询失败'));
              }
            });
          } catch (error) {
            if (!callbackCalled) {
              callbackCalled = true;
              console.error('[Content] 发送消息时出错:', error);
              clearTimeout(timeoutId);
              reject(new Error(`发送消息异常: ${error.message}`));
            }
          }
        };
        
        // 开始处理，带有重试机制
        handleQuestions();
      });
    });

    // 处理Promise结果
    processQuestions.then(result => {
      if (!callbackCalled) {
        callbackCalled = true;
        sendResponse(result);
      }
    }).catch(error => {
      if (!callbackCalled) {
        callbackCalled = true;
        sendResponse({error: error.message});
      }
    });

    return true; // 保持消息通道开放
  }
  return true;
});

// 显示答案
function displayAnswers(questions, answers) {
  questions.forEach((question, index) => {
    const examItem = document.querySelector(`input[name="${question.name}"]`).closest('.exam-item');
    const titleElement = examItem.querySelector('.exam-item-title .exam-stem');
    
    // 检查是否已存在答案提示
    let answerSpan = titleElement.querySelector('.answer-hint');
    if (!answerSpan) {
      answerSpan = document.createElement('span');
      answerSpan.className = 'answer-hint';
      answerSpan.style.color = '#2E7D32';
      answerSpan.style.fontWeight = 'bold';
      answerSpan.style.marginLeft = '10px';
      titleElement.appendChild(answerSpan);
    }
    
    const answerText = answers[index];
    
    // 根据题目类型格式化答案显示
    if (question.type === 'multiple') {
      if (answerText === '未知') {
        answerSpan.textContent = `{多选答案: 未知}`;
        answerSpan.style.color = '#FFA000'; // 黄色警告
      } else {
        // 如果答案中已包含逗号，直接使用，否则添加空格提高可读性
        let formattedAnswer = answerText;
        if (!answerText.includes(',') && !answerText.includes('，')) {
          // 无逗号时才进行字符分割处理
          formattedAnswer = answerText.split('').join(' ');
        }
        answerSpan.textContent = `{多选答案: ${formattedAnswer}}`;
      }
    } else {
      // 单选题答案
      answerSpan.textContent = `{答案: ${answerText}}`;
    }
  });
}

function detectQuestions() {
  const questions = [];
  
  try {
    console.log('[Content] 开始检测页面上的题目');
    
    // 查找所有题目元素
    const examItems = document.querySelectorAll('.exam-item');
    console.log('[Content] 找到exam-item元素数量:', examItems.length);
    
    if (examItems.length === 0) {
      console.log('[Content] 未找到任何exam-item元素');
      return [];
    }
    
    examItems.forEach((item, index) => {
      try {
        // 获取题目标题
        const titleElement = item.querySelector('.exam-item-title .exam-stem');
        if (!titleElement) {
          console.log(`[Content] 第${index+1}个exam-item没有找到题目标题元素`);
          return;
        }
        
        const questionText = titleElement.textContent.trim();
        const options = [];
        let type = '';
        let name = '';
        
        // 更广泛地检查单选题选项
        let radioInputs = item.querySelectorAll('input[name^="danxuan"], input[type="radio"]');
        
        // 如果没有通过简单匹配找到，尝试查找包含"DanXuan"字符串的单选题
        if (radioInputs.length === 0) {
          console.log(`[Content] 第${index+1}个exam-item尝试查找包含DanXuan的选项`);
          radioInputs = item.querySelectorAll('input[name*="DanXuan"], input[name*="danxuan"], input[id*="DanXuan"], input[id*="danxuan"]');
        }
        
        if (radioInputs.length > 0) {
          console.log(`[Content] 第${index+1}个exam-item检测到单选题，有${radioInputs.length}个选项`);
          type = 'single';
          name = radioInputs[0].getAttribute('name');
          radioInputs.forEach(input => {
            // 寻找相关联的label
            let label;
            const forLabel = document.querySelector(`label[for="${input.id}"]`);
            if (forLabel) {
              label = forLabel.textContent.trim();
            } else {
              label = input.parentElement.textContent.trim();
            }
            options.push(label);
          });
        }
        
        // 更广泛地检查多选题选项
        let checkboxInputs = item.querySelectorAll('input[name^="duoxuan"], input[type="checkbox"]');
        
        // 如果没有通过简单匹配找到，尝试查找包含"DuoXuan"字符串的多选题
        if (checkboxInputs.length === 0) {
          checkboxInputs = item.querySelectorAll('input[name*="DuoXuan"], input[name*="duoxuan"], input[id*="DuoXuan"], input[id*="duoxuan"]');
        }
        
        if (checkboxInputs.length > 0) {
          type = 'multiple';
          name = checkboxInputs[0].getAttribute('name');
          checkboxInputs.forEach(input => {
            // 寻找相关联的label
            let label;
            const forLabel = document.querySelector(`label[for="${input.id}"]`);
            if (forLabel) {
              label = forLabel.textContent.trim();
            } else {
              label = input.parentElement.textContent.trim();
            }
            options.push(label);
          });
        }
        
        // 如果仍未找到选项，尝试使用通用方法从表格中提取
        if (options.length === 0) {
          const optionTable = item.querySelector('table');
          if (optionTable) {
            console.log(`[Content] 第${index+1}个exam-item尝试从表格提取选项`);
            const inputs = optionTable.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            
            if (inputs.length > 0) {
              console.log(`[Content] 第${index+1}个exam-item在表格中找到${inputs.length}个选项，类型: ${inputs[0].type}`);
              type = inputs[0].type === 'radio' ? 'single' : 'multiple';
              name = inputs[0].getAttribute('name');
              
              inputs.forEach(input => {
                // 寻找相关联的label
                let label;
                const forLabel = document.querySelector(`label[for="${input.id}"]`);
                if (forLabel) {
                  label = forLabel.textContent.trim();
                  console.log(`[Content] 通过for标签找到选项: ${label}`);
                } else {
                  label = input.parentElement.textContent.trim();
                  console.log(`[Content] 通过父元素找到选项: ${label}`);
                }
                options.push(label);
              });
            }
          }
        }
        
        if (options.length > 0) {
          let examno = '';
          
          // 处理可能的命名格式
          if (name.includes('┣')) {
            // 原始格式
            const nameComponents = name.split('┣');
            examno = nameComponents[1] || '';
          } else {
            // 新格式，尝试从名称或页面其他元素提取编号
            // 如果无法提取，则使用问题文本中的数字作为备选
            const questionNumber = questionText.match(/^\d+\.?\d*/);
            if (questionNumber) {
              examno = questionNumber[0].replace(/\.$/, '');
            }
          }
          
          questions.push({
            text: questionText,
            options: options,
            type: type,
            examno: examno,
            name: name
          });
          console.log(`[Content] 成功提取第${index+1}个题目:`, questionText.substring(0, 20) + '...');
        } else {
          console.log(`[Content] 第${index+1}个exam-item没有选项或无法识别题目类型`);
        }
      } catch (itemError) {
        console.error(`[Content] 处理第${index+1}个exam-item时出错:`, itemError);
      }
    });
    
    return questions;
  } catch (error) {
    console.error('[Content] 检测题目过程出错:', error);
    return [];
  }
}